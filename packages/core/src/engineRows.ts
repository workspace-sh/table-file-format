// A table's rows read by the engine (table-file-format#867, step 1): each rows file's bytes go to
// it as they are (still compressed, when an archive holds them so), and the rows come back from
// it in the order and the words the TypeScript reader gives them (parse-text.ts). Behind a
// switch (`setRowsThroughEngine`) until both readers give the same rows for every fixture, and
// every test passes through it.

import { call, callBytes, callWindow } from "./engine.js";
import { keepLine, notJson, repeatedRow, type KeptLineAt } from "./parse-text.js";
import type { Row, UnreadLine, ValidationError } from "./types.js";

/** A rows file as the engine takes it. */
export interface RowsFileBytes {
  /** Its name in the table's rows/ (for `rowFiles`). */
  name: string;
  /** What a line's message names it as. */
  label: string;
  bytes: Uint8Array;
  /** Still compressed, as the zip entry holds it: how, and what it inflates to. */
  zip?: { method: number; size: number; crc: number };
  /** A byte order mark at its start isn't part of its first line, as TextDecoder reads it. */
  stripBom: boolean;
}

/** A row's key the engine sends: the id, or a key the schema doesn't name. */
const ID = 0xfffe;
const EXTRA = 0xffff;

/** Rows as the engine sends them, as rows. */
export function rowsOf(w: ReturnType<typeof callWindow>, fields: readonly string[], into: Row[]): void {
  const { entries, kinds, numbers, texts, ends } = w;
  let e = 0;
  let k = 0;
  let n = 0;
  let t = 0;
  let last = 0;
  const text = () => {
    const end = ends[t++]!;
    const s = texts.slice(last, end);
    last = end;
    return s;
  };
  while (e < entries.length) {
    const count = entries[e++]!;
    const row = {} as Row;
    for (let j = 0; j < count; j++) {
      const key = entries[e++]!;
      const kind = kinds[k++]!;
      const name = key === ID ? "id" : key === EXTRA ? text() : fields[key]!;
      const value: unknown =
        kind === 1 ? null : kind === 2 ? numbers[n++] : kind === 3 || kind === 4 ? text() : kind === 5 ? true : kind === 6 ? false : JSON.parse(text());
      // JSON.parse gives "__proto__" as a key of its own; an assignment would set the prototype.
      if (name === "__proto__") Object.defineProperty(row, name, { value, enumerable: true, writable: true, configurable: true });
      else (row as Record<string, unknown>)[name] = value;
    }
    into.push(row);
  }
}

/** How many rows cross at a time. */
const WINDOW = 50_000;

/**
 * A table's rows from its rows files, in file order, through the engine, and which file held which
 * rows: what parseRowsText gives for the same files, its diagnostics and kept lines included.
 */
export function readRowsThroughEngine(
  fields: readonly string[],
  files: readonly RowsFileBytes[],
  diagnostics: ValidationError[],
  unread: UnreadLine[],
): { rows: Row[]; rowFiles: { name: string; ids: string[] }[] } {
  const { handle, rows, rowFiles } = holdRowsFiles(fields, files, diagnostics, unread);
  call("rows.free", { handle });
  return { rows, rowFiles };
}

/**
 * readRowsThroughEngine, the rows kept by the engine as `handle` (let go with `rows.free`): a table
 * held from its files, which it can write back as they were read (`rowsFilesThroughEngine`).
 */
export function holdRowsFiles(
  fields: readonly string[],
  files: readonly RowsFileBytes[],
  diagnostics: ValidationError[],
  unread: UnreadLine[],
): { handle: number; rows: Row[]; rowFiles: { name: string; ids: string[] }[] } {
  const handle = call<number>("rows.new", { fields });
  try {
    const counts = files.map((f) => callBytes<number>("rows.read", { handle, file: f.label, stripBom: f.stripBom, ...(f.zip ?? {}) }, f.bytes));
    const total = call<number>("rows.count", { handle });
    const rows: Row[] = [];
    for (let from = 0; from < total; from += WINDOW) rowsOf(callWindow("rows.window", { handle, from, to: Math.min(total, from + WINDOW) }), fields, rows);
    type Line = { file: number; line: number; is: "not-json" | "not-row" | "no-id" | "repeat"; rowsBefore: number; first?: number; text: string };
    for (const l of call<Line[]>("rows.lines", { handle })) {
      const at: KeptLineAt = { line: l.line, text: l.text, file: files[l.file]!.label, after: l.rowsBefore > 0 ? rows[l.rowsBefore - 1]!.id : null };
      if (l.is === "not-json") {
        let err: unknown = null;
        try {
          JSON.parse(l.text);
        } catch (thrown) {
          err = thrown;
        }
        // JSON that the engine still couldn't read: nested past the 128 levels it reads, so a line can't exhaust its stack.
        if (err === null) keepLine(diagnostics, unread, at, "is nested more than 128 levels deep, past what a row can be", "line.too-deep");
        else keepLine(diagnostics, unread, at, ...notJson(l.text, err));
      } else if (l.is === "not-row") keepLine(diagnostics, unread, at, "isn't a row", "line.not-row");
      else if (l.is === "no-id") keepLine(diagnostics, unread, at, "is a row without an id", "id.missing");
      else repeatedRow(diagnostics, unread, at, rows[l.first!]!, JSON.parse(l.text) as Row);
    }
    const rowFiles: { name: string; ids: string[] }[] = [];
    let at = 0;
    files.forEach((f, i) => {
      rowFiles.push({ name: f.name, ids: rows.slice(at, at + counts[i]!).map((r) => r.id) });
      at += counts[i]!;
    });
    return { handle, rows, rowFiles };
  } catch (e) {
    call("rows.free", { handle });
    throw e;
  }
}

/**
 * A rows file as the engine writes it: its name, and its text, or none when it's the file on disk.
 * `compare`: what's on disk isn't known (a save that may be part done), so the file there is compared
 * with the text before it's written.
 */
export interface RowsFileOut {
  name: string;
  text?: string;
  compare?: true;
}

/**
 * A held table's rows as its rows files, as layoutRows lays them out (#867, step 3c): `names` are
 * the rows files it was read from, in order; `computed`, the fields not stored. A row is written as
 * its line, so one nobody edited keeps its bytes; a file whose lines are those on disk (as read, or as
 * the last save wrote them) isn't given (no `text`), and needn't be read to be compared. `save` is
 * said back to `rowsSaved` once the files are written, or once writing them failed.
 */
export function rowsFilesThroughEngine(held: { handle: number }, options: { names: readonly string[]; computed?: readonly string[]; limit?: number }): { files: RowsFileOut[]; save: number } {
  const w = callWindow("rows.files", { handle: held.handle, names: options.names, computed: options.computed ?? [], ...(options.limit === undefined ? {} : { limit: options.limit }) });
  const out: RowsFileOut[] = [];
  let t = 0;
  let from = 0;
  const next = (): string => {
    const end = w.ends[t++]!;
    const text = w.texts.slice(from, end);
    from = end;
    return text;
  };
  for (const kind of w.kinds) {
    const name = next();
    out.push(kind === 0 ? { name } : kind === 1 ? { name, text: next() } : { name, text: next(), compare: true });
  }
  return { files: out, save: w.numbers[0]! };
}

/** The save `rowsFilesThroughEngine` gave landed, or didn't: what the rows files on disk now hold, as far as the engine knows. */
export function rowsSaved(held: { handle: number }, save: number, landed: boolean): void {
  call("rows.saved", { handle: held.handle, save, landed });
}
