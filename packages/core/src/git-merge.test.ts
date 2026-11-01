// A table kept in git, merged with `merge=union` (SPEC section 3, "Keeping a
// table in git"; D54, #620): two branches that add rows both write the end of
// the last rows file, and a row edited on both comes out on two lines. Run
// with real git; skipped where there is none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTable } from "./parser.js";
import { writeTable } from "./writer.js";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const SCHEMA = JSON.stringify({ fields: [{ name: "title", type: "string" }] }, null, 2) + "\n";
const line = (row: object) => JSON.stringify(row) + "\n";

test("two branches merged with merge=union: both sides' rows, one copy of a row edited on both, the other kept", { skip: !hasGit && "no git" }, async () => {
  const repo = await mkdtemp(join(tmpdir(), "table-git-merge-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" });
  const rows = join(repo, "work", "tasks.table", "tables", "tasks", "rows", "0001.ndjson");
  const table = join(repo, "work", "tasks.table", "tables", "tasks");
  try {
    git("init", "-q");
    await mkdir(join(table, "rows"), { recursive: true });
    await writeFile(join(repo, ".gitattributes"), "**/*.table/tables/*/rows/*.ndjson merge=union\n");
    await writeFile(join(table, "schema.json"), SCHEMA);
    await writeFile(rows, line({ id: "r1", title: "First" }) + line({ id: "r2", title: "Second" }));
    git("add", ".");
    git("commit", "-q", "-m", "a table");

    git("checkout", "-q", "-b", "theirs");
    await writeFile(rows, line({ id: "r1", title: "First, theirs" }) + line({ id: "r2", title: "Second" }) + line({ id: "b1", title: "Added by them" }));
    git("commit", "-q", "-am", "theirs");

    git("checkout", "-q", "main");
    await writeFile(rows, line({ id: "r1", title: "First, ours" }) + line({ id: "r2", title: "Second" }) + line({ id: "a1", title: "Added by us" }));
    git("commit", "-q", "-am", "ours");

    // No conflict: union keeps both sides' lines.
    git("merge", "-q", "--no-edit", "theirs");

    const merged = await parseTable(table);
    assert.deepEqual(
      merged.rows.map((r) => [r.id, r.title]),
      [["r1", "First, ours"], ["r2", "Second"], ["a1", "Added by us"], ["b1", "Added by them"]],
    );
    // Union repeats lines both sides kept, too: r2, exactly, which is left out.
    assert.deepEqual(
      merged.diagnostics?.map((d) => d.message.replace(/, and .*/, "")),
      ['rows/0001.ndjson: line 4 repeats the id "r1" of a row before it', 'rows/0001.ndjson: line 5 repeats the row "r2" before it exactly'],
    );
    assert.deepEqual(merged.unread?.map((u) => u.text), ['{"id":"r1","title":"First, theirs"}']);

    // Written back, the later r1 is still in the file, and the table reads the same.
    await writeTable(table, merged);
    const text = await readFile(rows, "utf8");
    assert.match(text, /"First, theirs"/);
    assert.equal(text.match(/"r2"/g)?.length, 1);
    const again = await parseTable(table);
    assert.deepEqual(again.rows, merged.rows);
    assert.deepEqual(again.unread, merged.unread);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
