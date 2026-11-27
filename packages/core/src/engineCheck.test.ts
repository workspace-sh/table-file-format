// A large table's rows checked as its index is made (#867, step 2c): file by file, in pieces cut
// anywhere, the check says what problemsOf says of the same rows in memory; it's kept with the
// index, said to be from before an edit once there's been one, and never read from another
// version of the checks.
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHECK_WINDOW, startCheck } from "./engineCheck.js";
import { buildIndex, checkOf, putRows, removeRows, type SqlDriver } from "./indexer.js";
import { problemsOf, type IndexCheck, type ProblemCode } from "./problems.js";
import { problemRows, problemSchema as schema, random } from "./viewCases.js";
import type { ParsedTable, Row } from "./types.js";

/** Rows checked as a build reads them: in `files` rows files, each in pieces of any size. */
function checked(table: ParsedTable, files: number, seed: number, attachments?: string[]): IndexCheck | null {
  const r = random(seed);
  // Checked a few lines at a time, as a large file is a few megabytes at a time.
  const check = startCheck(table, { ...(attachments ? { attachments } : {}), batch: 1 + r.int(3000) })!;
  assert.ok(check, "a check is made");
  const per = Math.ceil(table.rows.length / files);
  for (let f = 0; f < files; f++) {
    const text =
      table.rows
        .slice(f * per, (f + 1) * per)
        .map((row) => JSON.stringify(row))
        .join("\n") + (r.int(2) === 0 ? "\n" : "");
    const bytes = new TextEncoder().encode(text);
    check.beginFile(`rows/${String(f + 1).padStart(4, "0")}.ndjson`);
    // Cut anywhere, a character's bytes included.
    for (let at = 0; at < bytes.length;) {
      const next = Math.min(bytes.length, at + 1 + r.int(700));
      check.piece(bytes.subarray(at, next));
      at = next;
    }
    check.endFile(`rows/${String(f + 1).padStart(4, "0")}.ndjson`);
  }
  return check.finish();
}

test("a table checked file by file has the problems problemsOf finds of it in memory, the first of them in full", () => {
  let compared = 0;
  const seen = new Set<ProblemCode>();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rows = problemRows(seed, 400);
    const r = random(seed * 7);
    const bodies: Record<string, string> = {};
    for (const id of [rows[0]!.id, rows[5]!.id, "gone page", "2"]) if (r.int(3) !== 0) bodies[id] = "a page";
    const table: ParsedTable = {
      path: "",
      schema,
      rows,
      views: [],
      meta: {} as never,
      bodies,
    };
    const attachments = ["a.png", "b.png", "unused.png", "c.png"].filter(() => r.int(4) !== 0);
    const check = checked(table, 1 + (seed % 4), seed, attachments);
    assert.ok(check, `seed ${seed}: checked`);
    assert.equal(check.rows, rows.length);
    const indexed: ParsedTable = {
      ...table,
      rows: [],
      indexed: { count: rows.length, version: 1, checked: check },
    };
    for (const context of [{ attachments }, {}]) {
      const want = problemsOf(table, "t", context);
      const got = problemsOf(indexed, "t", context);
      const listed = got.filter((p) => p.code !== "rows.more-problems");
      assert.equal(listed.length, Math.min(CHECK_WINDOW, want.length), `seed ${seed}: how many listed`);
      assert.deepEqual(listed, want.slice(0, listed.length), `seed ${seed}: the first problems`);
      const more = got.find((p) => p.code === "rows.more-problems");
      assert.equal(more?.details.total, want.length > CHECK_WINDOW ? want.length : undefined, `seed ${seed}: how many in all`);
      compared += listed.length;
    }
    const counts: Partial<Record<ProblemCode, number>> = {};
    for (const p of problemsOf(table, "t", { attachments })) counts[p.code] = (counts[p.code] ?? 0) + 1;
    assert.deepEqual(check.counts, counts, `seed ${seed}: counted by code`);
    for (const code of Object.keys(counts)) seen.add(code as ProblemCode);
  }
  assert.ok(compared > 1500, `compared ${compared} problems`);
  // Every kind a check finds was found (a relation is another table's rows: not followed).
  const kinds: ProblemCode[] = [
    "value.required",
    "value.type",
    "value.choice",
    "value.minimum",
    "value.maximum",
    "value.exclusive-minimum",
    "value.exclusive-maximum",
    "value.min-length",
    "value.max-length",
    "value.unique",
    "key.primary",
    "key.unique",
    "body.orphaned",
    "choice.unused",
    "attachment.orphaned",
  ];
  assert.deepEqual(
    kinds.filter((k) => !seen.has(k)),
    [],
  );
});

test("a check from before an edit says so, and no problems; with none, the table isn't checked", () => {
  const rows = problemRows(3, 100);
  const table: ParsedTable = {
    path: "",
    schema,
    rows,
    views: [],
    meta: {} as never,
  };
  const check = checked(table, 2, 3)!;
  const codes = (t: ParsedTable) => problemsOf(t, "t").map((p) => p.code);
  const indexed = (checked?: IndexCheck): ParsedTable => ({
    ...table,
    rows: [],
    indexed: {
      count: rows.length,
      version: 1,
      ...(checked ? { checked } : {}),
    },
  });
  assert.ok(codes(indexed(check)).includes("value.required"));
  for (const t of [
    indexed({ ...check, stale: true }),
    // The schema's rules changed since.
    {
      ...indexed(check),
      schema: {
        ...schema,
        fields: schema.fields.map((f) => (f.name === "n" ? { ...f, constraints: { maximum: 5 } } : f)),
      },
    },
    // A page added.
    { ...indexed(check), bodies: { [rows[1]!.id]: "new" } },
  ]) {
    assert.deepEqual(codes(t), ["rows.not-checked-since-edit"]);
  }
  // Attachments other than the ones it was checked against.
  assert.deepEqual(
    problemsOf(indexed(check), "t", { attachments: ["new.png"] }).map((p) => p.code),
    ["rows.not-checked-since-edit"],
  );
  assert.deepEqual(codes(indexed()), ["rows.not-checked"]);
  // A title isn't a rule: still checked.
  assert.ok(
    codes({
      ...indexed(check),
      schema: {
        ...schema,
        fields: schema.fields.map((f) => ({ ...f, title: `${f.name}!` })),
      },
    }).includes("value.required"),
  );
});

test("a line the engine can't read ends the check, saying where, and nothing is found", () => {
  const table: ParsedTable = {
    path: "",
    schema: { fields: [{ name: "n", type: "number" }] },
    rows: [],
    views: [],
    meta: {} as never,
  };
  const check = startCheck(table)!;
  check.piece(new TextEncoder().encode('{"id":"a","n":1}\n{"id":"b","\\ud800":2}\n'));
  check.endFile("rows/0002.ndjson");
  // What comes after is let be.
  check.piece(new TextEncoder().encode('{"id":"c"}'));
  check.endFile("rows/0003.ndjson");
  assert.equal(check.finish(), null);
  assert.match(check.failed ?? "", /rows\/0002\.ndjson: line 2/);
  // A table whose cells have their own formulas, or a pattern, isn't checked at all.
  assert.equal(startCheck({ ...table, cells: [{ id: "a", field: "n", expr: "(+ 1 1)" }] }), null);
  assert.equal(
    startCheck({
      schema: {
        fields: [{ name: "s", type: "string", constraints: { pattern: "x" } }],
      },
    }),
    null,
  );
});

// node:sqlite arrived in Node 22.5; where it's missing the index's part is untested.
let sqlite: { DatabaseSync: new (path: string) => any } | null = null;
try {
  sqlite = (await import("node:sqlite" as string)) as typeof sqlite;
} catch {
  sqlite = null;
}

function driver(): SqlDriver & { raw: any } {
  const db = new sqlite!.DatabaseSync(":memory:");
  return {
    raw: db,
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

test(
  "a check is kept with the index, said to be from before an edit after one, and not read from another version of the checks",
  { skip: sqlite ? false : "node:sqlite is not available" },
  async () => {
    const rows = problemRows(5, 60);
    const table: ParsedTable = {
      path: "",
      schema,
      rows,
      views: [],
      meta: {} as never,
    };
    const check = checked(table, 2, 5)!;
    const db = driver();
    // An index made before checks: no _checks table at all, and no error.
    await buildIndex(db, { name: "t", schema, rows, key: "k1" });
    db.raw.exec("drop table if exists _checks");
    assert.equal(await checkOf(db, "t"), null);
    await buildIndex(db, {
      name: "t",
      schema,
      rows,
      key: "k2",
      check: () => check,
    });
    assert.deepEqual(await checkOf(db, "t"), check);
    // An edit: kept, and from before it.
    await putRows(db, {
      name: "t",
      schema,
      rows: [{ ...rows[0]!, n: 50 } as Row],
      key: "k3",
    });
    assert.deepEqual(await checkOf(db, "t"), { ...check, stale: true });
    await buildIndex(db, {
      name: "t",
      schema,
      rows,
      key: "k4",
      check: () => check,
    });
    await removeRows(db, { name: "t", schema, ids: [rows[1]!.id], key: "k5" });
    assert.equal((await checkOf(db, "t"))?.stale, true);
    // Made again with no check: the one before is no one's.
    await buildIndex(db, { name: "t", schema, rows, key: "k6" });
    assert.equal(await checkOf(db, "t"), null);
    // Another version of what a check finds: not checked.
    await buildIndex(db, {
      name: "t",
      schema,
      rows,
      key: "k7",
      check: () => check,
    });
    db.raw.exec("update _checks set rules = rules + 1");
    assert.equal(await checkOf(db, "t"), null);
  },
);
