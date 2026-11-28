// A held table's rows written as its rows files by the engine (#867, step 3c): the files layoutRows
// gives for the same rows, as read and after edits, with only the files an edit changed written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyChanges, diffBundle } from "./changes.js";
import { formulaEngineSet } from "./engine.js";
import { applyToHeld, heldRowsAll, isRowChange, undoHeld } from "./engineEdits.js";
import { holdRowsFiles, rowsFilesThroughEngine as filesAndSave, rowsSaved, type RowsFileBytes } from "./engineRows.js";
import { freeRows } from "./engineViews.js";
import { layoutRows, rowsFileOrder } from "./rowFiles.js";
import { rowLine } from "./serialize.js";
import { readBundle, writeBundleTo, type TableFs } from "./io.js";
import { nodeFs } from "./node-fs.js";
import { random } from "./viewCases.js";
import { readZip } from "./zip.js";
import type { Field, ParsedBundle, Row, UnreadLine, ValidationError } from "./types.js";

/** The files alone: a save never said to land, so they're compared with the files as read. */
const rowsFilesThroughEngine = (...a: Parameters<typeof filesAndSave>) => filesAndSave(...a).files;

const skip = formulaEngineSet() ? false : "these tests need the engine (edn/js/src/node-engine.ts)";

const FIELDS: Field[] = [
  { name: "title", type: "string" },
  { name: "n", type: "number" },
  { name: "tags", type: "array" },
  { name: "total", type: "number", computed: { kind: "formula", expr: "n" } } as Field,
];
const SCHEMA = { fields: FIELDS };
const NAMES = FIELDS.map((f) => f.name);
const COMPUTED = ["total"];

type R = ReturnType<typeof random>;

/** A row's line, as a writer writes it (sometimes with a computed field, as an older writer might have). */
function rowText(r: R, i: number): string {
  const row: Row = { id: `r${i}` };
  if (r.int(4) !== 0) row.title = r.pick(["A", "B", "é", "", "a\nb", 'x"y', "🙂"]);
  if (r.int(3) !== 0) row.n = r.pick([0, 1, 1.5, -2, 1e21, 0.1]);
  if (r.int(4) === 0) row.tags = r.pick([["a"], ["a", "b"], []]);
  if (r.int(6) === 0) row.extra = { k: r.int(3) };
  if (r.int(7) === 0) row.total = r.int(9);
  return JSON.stringify(row);
}

/** A table's rows files as a writer left them: some lines that aren't rows, now and then a file without its last line end or with a blank line. */
function filesFor(r: R): { name: string; text: string }[] {
  const names = r.pick([["0001.ndjson"], ["0001.ndjson", "0002.ndjson"], ["0001.ndjson", "0002.ndjson", "0002m.ndjson", "0003.ndjson"], ["0001.ndjson", "0001m.ndjson", "0002.ndjson"]]);
  let i = 0;
  return names.map((name) => {
    const lines: string[] = [];
    for (let k = r.int(7); k > 0; k--) {
      const odd = r.int(12);
      if (odd === 0) lines.push("not json");
      else if (odd === 1) lines.push('{"no":"id"}');
      else if (odd === 2 && i > 0) lines.push(`{"id":"r${r.int(i)}","title":"again"}`);
      else lines.push(rowText(r, i++));
    }
    if (r.int(10) === 0 && lines.length > 1) lines.splice(1 + r.int(lines.length - 1), 0, "");
    const text = lines.join("\n");
    return { name, text: lines.length === 0 ? "" : r.int(10) === 0 ? text : `${text}\n` };
  });
}

const encoder = new TextEncoder();

/** The table held from its files, and what the TypeScript side keeps of it. */
function hold(files: { name: string; text: string }[]) {
  const bytes: RowsFileBytes[] = files.map((f) => ({ name: f.name, label: `rows/${f.name}`, bytes: encoder.encode(f.text), stripBom: false }));
  const diagnostics: ValidationError[] = [];
  const unread: UnreadLine[] = [];
  const held = holdRowsFiles(NAMES, bytes, diagnostics, unread);
  return { held: { handle: held.handle, fields: NAMES }, rowFiles: held.rowFiles, rows: held.rows, unread };
}

const bundleOf = (rows: Row[]): ParsedBundle => ({
  path: "/x.table",
  meta: { title: "X" },
  tables: { t: { path: "/x.table/tables/t", schema: SCHEMA, rows, views: [], meta: {} } },
});

/** One side's edit of the rows, as an app makes it: rows added, removed, moved, changed, and one put back with other values. */
function edited(r: R, rows: Row[]): Row[] {
  const next = JSON.parse(JSON.stringify(rows)) as Row[];
  for (let k = 1 + r.int(5); k > 0; k--) {
    const at = r.int(Math.max(1, next.length));
    switch (r.int(6)) {
      case 0:
        next.splice(r.int(next.length + 1), 0, { id: `new${r.int(1000)}`, title: r.pick(["N", "M".repeat(1 + r.int(40))]) });
        break;
      case 1:
        next.splice(at, 1);
        break;
      case 2: {
        const [moved] = next.splice(at, 1);
        if (moved) next.splice(r.int(next.length + 1), 0, moved);
        break;
      }
      default:
        if (next[at]) next[at] = { ...next[at]!, [r.pick(["title", "n", "tags", "other"])]: r.pick(["v", 7, ["z"], null, "", "long ".repeat(10)]) };
    }
  }
  return next.filter((row, i) => next.findIndex((o) => o.id === row.id) === i);
}

/** The files the engine writes, with each it says is as read filled in from what was read. */
function engineFiles(held: { handle: number }, names: string[], read: { name: string; text: string }[], limit: number) {
  return rowsFilesThroughEngine(held, { names, computed: COMPUTED, limit }).map((f) => {
    if (f.text !== undefined) return { name: f.name, text: f.text, written: true };
    const was = read.find((r) => r.name === f.name);
    assert.ok(was, `${f.name} is said to be as read, and wasn't read`);
    return { name: f.name, text: was.text, written: false };
  });
}

test("a held table's rows files are layoutRows's for the same rows: as read, after edits, after undo, at any limit", { skip }, () => {
  let splits = 0;
  let kept = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = random(seed);
    const files = filesFor(r);
    const { held, rowFiles, rows, unread } = hold(files);
    try {
      const names = files.map((f) => f.name);
      const limit = r.pick([25_000_000, 60, 200, 400]);
      const expect = (now: Row[], what: string) => {
        const want = layoutRows(now, rowLine(SCHEMA), { files: rowFiles, unread, limit });
        const got = engineFiles(held, names, files, limit);
        assert.deepEqual(
          got.map(({ name, text }) => ({ name, text })),
          want,
          `seed ${seed}, ${what}`,
        );
        if (want.length > files.length) splits++;
        kept += got.filter((f) => !f.written).length;
        return got;
      };
      // As read: a file is written again only when layoutRows would change it (one split off from
      // another is new, whatever name it has).
      const first = expect(rows, "as read");
      if (first.length <= files.filter((f) => f.text !== "").length || first.length === 1)
        for (const f of first) assert.equal(f.written, files.find((o) => o.name === f.name)?.text !== f.text, `seed ${seed}: ${f.name} written`);
      let now = rows;
      for (let e = 1 + r.int(3); e > 0; e--) {
        const after = edited(r, now);
        // A row taken out, then put back with other values: still written in its file.
        if (r.int(4) === 0 && after.length > 1) {
          const [gone] = after.splice(r.int(after.length), 1);
          applyToHeld(held, { schema: SCHEMA }, diffBundle(bundleOf(now), bundleOf(after)).filter(isRowChange));
          now = heldRowsAll(held);
          after.splice(r.int(after.length + 1), 0, { ...gone!, title: "back" });
        }
        applyToHeld(held, { schema: SCHEMA }, diffBundle(bundleOf(now), bundleOf(after)).filter(isRowChange));
        now = heldRowsAll(held);
        expect(now, `after edit ${e}`);
      }
      while (r.int(2) && undoHeld(held, { schema: SCHEMA })) {
        now = heldRowsAll(held);
        expect(now, "after an undo");
      }
    } finally {
      freeRows(held);
    }
  }
  // The cases above reached what they're for.
  assert.ok(splits > 20, `files split: ${splits}`);
  assert.ok(kept > 100, `files kept as read: ${kept}`);
});

test("only the file an edit changes is written; a file as read, untouched, is named alone", { skip }, () => {
  const files = [
    { name: "0001.ndjson", text: '{"id":"a","title":"A"}\n{"id":"b","title":"B"}\n' },
    { name: "0002.ndjson", text: '{"id":"c",  "title":"C", "n":1.50}\n' },
    { name: "0003.ndjson", text: '{"id":"d","title":"D","total":4}\n' },
  ];
  const { held, rows } = hold(files);
  try {
    const names = files.map((f) => f.name);
    // The third holds a computed field, never stored: written without it.
    assert.deepEqual(rowsFilesThroughEngine(held, { names, computed: COMPUTED }), [{ name: "0001.ndjson" }, { name: "0002.ndjson" }, { name: "0003.ndjson", text: '{"id":"d","title":"D"}\n' }]);
    const after = rows.map((row) => (row.id === "c" ? { ...row, title: "changed" } : row));
    applyToHeld(held, { schema: SCHEMA }, diffBundle(bundleOf(rows), bundleOf(after)).filter(isRowChange));
    // Its spacing and its number as written, the value changed alone.
    assert.deepEqual(rowsFilesThroughEngine(held, { names, computed: [] }), [{ name: "0001.ndjson" }, { name: "0002.ndjson", text: '{"id":"c",  "title":"changed", "n":1.50}\n' }, { name: "0003.ndjson" }]);
    undoHeld(held, { schema: SCHEMA });
    assert.deepEqual(rowsFilesThroughEngine(held, { names, computed: [] }), [{ name: "0001.ndjson" }, { name: "0002.ndjson" }, { name: "0003.ndjson" }]);
  } finally {
    freeRows(held);
  }
});

test("a table with no rows keeps one empty file; one never read is laid out from 0001", { skip }, () => {
  const { held } = hold([{ name: "0004.ndjson", text: "" }]);
  try {
    assert.deepEqual(rowsFilesThroughEngine(held, { names: ["0004.ndjson"] }), [{ name: "0004.ndjson" }]);
    assert.throws(() => rowsFilesThroughEngine(held, { names: [] }), /read from 1 rows files, and 0 names/);
    assert.throws(() => rowsFilesThroughEngine(held, { names: ["rows.ndjson"] }), /isn't a rows file's name/);
  } finally {
    freeRows(held);
  }
  const never = hold([]);
  try {
    assert.deepEqual(rowsFilesThroughEngine(never.held, { names: [] }), [{ name: "0001.ndjson", text: "" }]);
  } finally {
    freeRows(never.held);
  }
});

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

/** Each table of a fixture, folder or single file: its schema and its rows files, as text. */
function fixtureTables(): { label: string; schema: string; files: { name: string; text: string }[] }[] {
  const out: { label: string; schema: string; files: { name: string; text: string }[] }[] = [];
  for (const name of readdirSync(FIXTURES).filter((d) => d.endsWith(".table"))) {
    for (const t of readdirSync(join(FIXTURES, name, "tables"))) {
      const rows = join(FIXTURES, name, "tables", t, "rows");
      if (!existsSync(rows)) continue;
      out.push({ label: `${name}/${t}`, schema: readFileSync(join(FIXTURES, name, "tables", t, "schema.json"), "utf8"), files: rowsFileOrder(readdirSync(rows)).map((f) => ({ name: f, text: readFileSync(join(rows, f), "utf8") })) });
    }
  }
  const decoder = new TextDecoder();
  for (const name of readdirSync(join(FIXTURES, "single-file")).filter((d) => d.endsWith(".table"))) {
    const tables = new Map<string, { schema?: string; files: { name: string; text: string }[] }>();
    for (const e of readZip(new Uint8Array(readFileSync(join(FIXTURES, "single-file", name))))) {
      const m = /tables\/([^/]+)\/(?:(schema\.json)|rows\/([^/]+))$/.exec(e.name);
      if (!m) continue;
      const t = tables.get(m[1]!) ?? { files: [] };
      tables.set(m[1]!, t);
      if (m[2]) t.schema = decoder.decode(e.data);
      else if (rowsFileOrder([m[3]!]).length > 0) t.files.push({ name: m[3]!, text: decoder.decode(e.data) });
    }
    for (const [t, v] of tables) if (v.schema && v.files.length > 0) out.push({ label: `single-file/${name}/${t}`, schema: v.schema, files: rowsFileOrder(v.files.map((f) => f.name)).map((f) => v.files.find((x) => x.name === f)!) });
  }
  return out;
}

test("every fixture's rows files, opened and saved with no edit, are as they were: none written again", { skip }, () => {
  let tables = 0;
  for (const { label, schema: text, files } of fixtureTables()) {
    let schema: { fields: Field[] };
    try {
      schema = JSON.parse(text) as { fields: Field[] };
    } catch {
      continue; // A schema that isn't JSON: the table isn't read.
    }
    const fields = schema.fields.map((f) => f.name);
    const bytes: RowsFileBytes[] = files.map((f) => ({ name: f.name, label: `rows/${f.name}`, bytes: encoder.encode(f.text), stripBom: false }));
    const held = holdRowsFiles(fields, bytes, [], []);
    try {
      const out = rowsFilesThroughEngine(held, { names: files.map((f) => f.name), computed: schema.fields.filter((f) => f.computed).map((f) => f.name) });
      assert.deepEqual(out, files.map((f) => ({ name: f.name })), label);
      tables++;
    } finally {
      freeRows(held);
    }
  }
  assert.ok(tables > 20, `tables: ${tables}`);
});

/** Every file under `dir`, by its path there, as text. */
function filesUnder(dir: string, at = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(join(dir, at))) {
    const path = at ? `${at}/${name}` : name;
    if (statSync(join(dir, path)).isDirectory()) for (const [p, t] of filesUnder(dir, path)) out.set(p, t);
    else out.set(path, readFileSync(join(dir, path), "utf8"));
  }
  return out;
}

test("every fixture folder edited and saved through the engine is what the writer saves today, writing only the rows files the edit changed", { skip }, async () => {
  const folders = readdirSync(FIXTURES).filter((d) => d.endsWith(".table"));
  const tmp = mkdtempSync(join(tmpdir(), "engine-save-"));
  let written = 0;
  let kept = 0;
  try {
    for (const [i, name] of folders.entries()) {
      const r = random(100 + i);
      const today = join(tmp, `today-${name}`);
      const engine = join(tmp, `engine-${name}`);
      cpSync(join(FIXTURES, name), today, { recursive: true });
      cpSync(join(FIXTURES, name), engine, { recursive: true });
      const before = await readBundle(nodeFs, today);
      // Rows written as today's writer writes them, before the edit: a fixture whose lines it rewrites
      // can't be compared byte for byte (the engine keeps them as they are).
      const rewritten = new Set<string>();
      const after = JSON.parse(JSON.stringify(before)) as ParsedBundle;
      const helds = new Map<string, { handle: number; names: string[] }>();
      try {
        for (const [t, table] of Object.entries(before.tables)) {
          if (!table.rowFiles || table.rowFiles.length === 0) continue;
          const names = table.rowFiles.map((f) => f.name);
          const files = names.map((f) => ({ name: f, text: readFileSync(join(engine, "tables", t, "rows", f), "utf8") }));
          const laid = layoutRows(table.rows, rowLine(table.schema), { files: table.rowFiles, unread: table.unread ?? [] });
          if (laid.some((l) => files.find((f) => f.name === l.name)?.text !== l.text)) rewritten.add(t);
          const held = holdRowsFiles(table.schema.fields.map((f) => f.name), files.map((f) => ({ name: f.name, label: `rows/${f.name}`, bytes: encoder.encode(f.text), stripBom: false })), [], []);
          helds.set(t, { handle: held.handle, names });
          after.tables[t]!.rows = edited(r, table.rows);
        }
        const changes = diffBundle(before, after);
        const want = applyChanges(before, changes);
        await writeBundleTo(nodeFs, today, want);
        const through: ParsedBundle = { ...want, tables: { ...want.tables } };
        for (const [t, held] of helds) {
          applyToHeld({ handle: held.handle, fields: [] }, before.tables[t]!, changes.filter((c) => isRowChange(c) && c.table === t));
          assert.deepEqual(heldRowsAll({ handle: held.handle, fields: before.tables[t]!.schema.fields.map((f) => f.name) }), want.tables[t]!.rows, `${name}/${t}: rows`);
          through.tables[t] = { ...want.tables[t]!, held };
        }
        // What was written, and what was read to compare.
        const staged: string[] = [];
        const spy: TableFs = { ...nodeFs, writeText: (path, content) => (path.includes("/rows/") && staged.push(path), nodeFs.writeText(path, content)) };
        await writeBundleTo(spy, engine, through);
        const a = filesUnder(today);
        const b = filesUnder(engine);
        assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), `${name}: the same files`);
        for (const [path, text] of a) if (![...rewritten].some((t) => path.startsWith(`tables/${t}/rows/`))) assert.equal(b.get(path), text, `${name}: ${path}`);
        for (const [t, held] of helds) {
          const changed = held.names.filter((f) => readFileSync(join(FIXTURES, name, "tables", t, "rows", f), "utf8") !== b.get(`tables/${t}/rows/${f}`));
          const wrote = staged.filter((p) => p.includes(`/tables/${t}/rows/`)).map((p) => p.split("/").at(-1)!.replace(/\.tmp$/, ""));
          // Only a file the edit changed, or a new one.
          for (const f of wrote) assert.ok(changed.includes(f) || !held.names.includes(f), `${name}/${t}: ${f} written, and unchanged`);
          written += wrote.length;
          kept += held.names.length - wrote.length;
        }
      } finally {
        for (const held of helds.values()) freeRows({ handle: held.handle, fields: [] });
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(written > 0 && kept >= 0, `written ${written}, kept ${kept}`);
});

test("a save compares with what the last save wrote: undone after it, the file is written back; not landed, every file is compared", { skip }, () => {
  const files = [
    { name: "0001.ndjson", text: '{"id":"a","title":"A"}\n' },
    { name: "0002.ndjson", text: '{"id":"b","title":"B"}\n' },
  ];
  const { held, rows } = hold(files);
  const names = files.map((f) => f.name);
  const save = (landed = true) => {
    const out = filesAndSave(held, { names });
    rowsSaved(held, out.save, landed);
    return out.files;
  };
  try {
    const edit = rows.map((row) => (row.id === "b" ? { ...row, title: "edited" } : row));
    applyToHeld(held, { schema: SCHEMA }, diffBundle(bundleOf(rows), bundleOf(edit)).filter(isRowChange));
    assert.deepEqual(save(), [{ name: "0001.ndjson" }, { name: "0002.ndjson", text: '{"id":"b","title":"edited"}\n' }]);
    // Saved again, nothing changed: nothing written.
    assert.deepEqual(save(), [{ name: "0001.ndjson" }, { name: "0002.ndjson" }]);
    // Undone: the file as read again, which isn't what's on disk now.
    undoHeld(held, { schema: SCHEMA });
    assert.deepEqual(save(), [{ name: "0001.ndjson" }, { name: "0002.ndjson", text: '{"id":"b","title":"B"}\n' }]);
    // The row gone, its file with it; put back, its file is written again, though it's as read.
    applyToHeld(held, { schema: SCHEMA }, [{ op: "delete", table: "t", row: "b", values: { id: "b", title: "B" } }]);
    assert.deepEqual(save(), [{ name: "0001.ndjson" }]);
    undoHeld(held, { schema: SCHEMA });
    assert.deepEqual(save(false), [{ name: "0001.ndjson" }, { name: "0002.ndjson", text: '{"id":"b","title":"B"}\n' }]);
    // That save not landed: every file given, to compare with what's there.
    assert.deepEqual(save(), [
      { name: "0001.ndjson", text: '{"id":"a","title":"A"}\n', compare: true },
      { name: "0002.ndjson", text: '{"id":"b","title":"B"}\n', compare: true },
    ]);
    assert.deepEqual(save(), [{ name: "0001.ndjson" }, { name: "0002.ndjson" }]);
    // A save another began since isn't the one that landed: not known either.
    const first = filesAndSave(held, { names });
    filesAndSave(held, { names });
    rowsSaved(held, first.save, true);
    assert.ok(rowsFilesThroughEngine(held, { names }).every((f) => f.compare));
  } finally {
    freeRows(held);
  }
});
