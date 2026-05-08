import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTable } from "./parser.js";
import { writeTable } from "./writer.js";

test("writeTable round-trips through parseTable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "table-test-"));
  try {
    const target = join(dir, "out.table");
    await writeTable(target, {
      schema: {
        fields: [{ name: "title", type: "string", constraints: { required: true } }],
        primaryKey: ["title"],
        "schema-version": 1,
      },
      rows: [
        { id: "r1", title: "one" },
        { id: "r2", title: "two" },
      ],
      views: [],
      meta: { title: "Test", generator: "writer.test" },
    });

    const round = await parseTable(target);
    assert.equal(round.rows.length, 2);
    assert.equal(round.rows[0]!.title, "one");
    assert.equal(round.meta.title, "Test");
    assert.equal(round.meta.format, "table");
    assert.equal(round.meta.formatVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeTable terminates rows.ndjson with a trailing newline (POSIX)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "table-test-"));
  try {
    const target = join(dir, "out.table");
    await writeTable(target, {
      schema: { fields: [{ name: "x", type: "string" }] },
      rows: [{ id: "r1", x: "hello" }],
    });
    const ndjson = await readFile(join(target, "rows.ndjson"), "utf8");
    assert.ok(ndjson.endsWith("\n"), "rows.ndjson must end with \\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeTable stamps format and formatVersion when meta omits them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "table-test-"));
  try {
    const target = join(dir, "out.table");
    await writeTable(target, {
      schema: { fields: [{ name: "x", type: "string" }] },
      rows: [],
    });
    const meta = JSON.parse(await readFile(join(target, "meta.json"), "utf8"));
    assert.equal(meta.format, "table");
    assert.equal(meta.formatVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
