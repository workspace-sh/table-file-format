// A large table saved after one cell is edited (table-file-format#867, step 3c): as the writer saves
// it today (writeBundleTo with the rows in JavaScript: every row laid out, every rows file read to
// compare, the changed one written), and with the rows held by the engine (rows.files: the file the
// edit changed is written; the others aren't laid out, read or written).
//
//   node --expose-gc --conditions=source --import tsx edn/bench/engine-save.mts <file.table> <wasm|native> [saves]
//
// Each save follows its own edit, of a row a long way in, a different one each time (5 by default);
// the first, the median and the slowest are said. "rows.files" is the engine's part alone.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadEdn } from "../js/src/index.ts";
import { applyChanges, type BundleChange } from "../../packages/core/src/changes.ts";
import { setFormulaEngine } from "../../packages/core/src/engine.ts";
import { applyToHeld } from "../../packages/core/src/engineEdits.ts";
import { holdRowsFiles, rowsFilesThroughEngine } from "../../packages/core/src/engineRows.ts";
import { readBundle, writeBundleTo } from "../../packages/core/src/io.ts";
import { nodeFs } from "../../packages/core/src/node-fs.ts";
import { readZip } from "../../packages/core/src/zip.ts";
import type { ParsedBundle } from "../../packages/core/src/types.ts";

const [file, binding, times] = process.argv.slice(2) as [string, "wasm" | "native", string | undefined];
const N = Number(times ?? 5);
setFormulaEngine((await loadEdn({ binding })) as never);

// The archive as a folder, twice: one saved each way.
const tmp = mkdtempSync(join(tmpdir(), "engine-save-"));
const folders = [join(tmp, "today.table"), join(tmp, "engine.table")];
for (const e of readZip(new Uint8Array(readFileSync(file)))) {
  const path = e.name.replace(/^[^/]+\//, "");
  for (const f of folders) {
    mkdirSync(dirname(join(f, path)), { recursive: true });
    writeFileSync(join(f, path), e.data);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const say = (way: string, ms: number[], rows: number) =>
  console.log(JSON.stringify({ binding, way, rows, first: +ms[0]!.toFixed(1), median: +median(ms).toFixed(1), slowest: +Math.max(...ms).toFixed(1) }));
const gc = () => (globalThis as { gc?: () => void }).gc?.();

try {
  const bundle = await readBundle(nodeFs, folders[0]!);
  const [name, table] = Object.entries(bundle.tables)[0]!;
  const rows = table.rows;
  const field = table.schema.fields.find((f) => f.type === "string" && !f.computed)!.name;
  const at = (i: number) => Math.floor(rows.length / 2) + i * 997;
  const edit = (i: number): BundleChange => ({ op: "set", table: name, row: rows[at(i)]!.id, field, to: `edited ${i}` });

  // Today: the rows in JavaScript, edited as a merge edits them, the bundle written.
  const today: number[] = [];
  let now: ParsedBundle = bundle;
  for (let i = 0; i < N; i++) {
    now = applyChanges(now, [edit(i)]);
    gc();
    const s = performance.now();
    await writeBundleTo(nodeFs, folders[0]!, now);
    today.push(performance.now() - s);
  }
  say("today: writeBundleTo", today, rows.length);

  // The engine: the rows held from the folder's files, edited there, the bundle written with them.
  const names = table.rowFiles!.map((f) => f.name);
  const dir = join(folders[1]!, "tables", name, "rows");
  const held = holdRowsFiles(
    table.schema.fields.map((f) => f.name),
    names.map((f) => ({ name: f, label: `rows/${f}`, bytes: readFileSync(join(dir, f)), stripBom: false })),
    [],
    [],
  );
  const heldRows = { handle: held.handle, fields: table.schema.fields.map((f) => f.name) };
  const computed = table.schema.fields.filter((f) => f.computed).map((f) => f.name);
  const engine: number[] = [];
  const files: number[] = [];
  let theirs: ParsedBundle = bundle;
  for (let i = 0; i < N; i++) {
    applyToHeld(heldRows, table, [edit(i) as never]);
    // The rows for the cells and pages: the same as today's (none of this table's are cells or pages).
    theirs = applyChanges(theirs, [edit(i)]);
    const input: ParsedBundle = { ...theirs, tables: { [name]: { ...theirs.tables[name]!, held: { handle: held.handle, names } } as never } };
    gc();
    let s = performance.now();
    rowsFilesThroughEngine(heldRows, { names, computed });
    files.push(performance.now() - s);
    gc();
    s = performance.now();
    await writeBundleTo(nodeFs, folders[1]!, input);
    engine.push(performance.now() - s);
  }
  say("engine: rows.files", files, rows.length);
  say("engine: writeBundleTo", engine, rows.length);
  // The same bytes on disk, each way.
  for (const f of names) if (!readFileSync(join(folders[0]!, "tables", name, "rows", f)).equals(readFileSync(join(dir, f)))) console.log(JSON.stringify({ differs: f }));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
