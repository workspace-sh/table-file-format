/**
 * A cell's own formula (SPEC section 3, "A cell's own formula"; D52, D54):
 * the table's `cells/` lines read and written, and which of them applies to
 * which cell.
 */

import type { CellFormula, Row, TableSchema, ValidationError } from "./types.js";
import { ROWS_FILE_BYTES, utf8Length } from "./rowFiles.js";

/** An absent key, null and "" are all empty (SPEC section 2, "Empty values"). */
const isEmptyValue = (v: unknown) => v === undefined || v === null || v === "";

/** The folder a table's cells' formulas are in. */
export const CELLS_DIR = "cells";

/**
 * A `cells/` file's lines, skip-and-collect as rows are: a line that isn't
 * a cell's formula is kept in `unread`, as it was, and said.
 */
export function parseCellsText(raw: string, diagnostics: ValidationError[], unread: string[], file: string): CellFormula[] {
  const cells: CellFormula[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      obj = null;
    }
    const c = obj as CellFormula | null;
    // A cell's formula, its note, or both (D52, D57).
    const what = c !== null && typeof c === "object" && !Array.isArray(c) && (typeof c.expr === "string" || typeof c.note === "string") && (c.expr === undefined || typeof c.expr === "string") && (c.note === undefined || typeof c.note === "string");
    if (!what || typeof c!.id !== "string" || c!.id === "" || typeof c!.field !== "string" || c!.field === "") {
      diagnostics.push({ rowIndex: i, message: `${file}: line ${i + 1} isn't a cell's formula or note, and is kept as it is: ${line.slice(0, 60)}` });
      unread.push(line);
      continue;
    }
    cells.push(c);
  }
  return cells;
}

const cellKey = (id: string, field: string) => `${id}\u0000${field}`;

/**
 * The formula each cell has of its own, by row id and field name: the
 * first line for a cell (D54), on a row and a field the table has, never
 * `id`. A stored field whose row holds a value as well has none: the value
 * was typed after the formula, by an app that doesn't know `cells/`, and
 * wins (D52).
 */
export function cellFormulas(schema: TableSchema, rows: readonly Row[], cells: readonly CellFormula[] | undefined): Map<string, Map<string, CellFormula>> {
  const out = new Map<string, Map<string, CellFormula>>();
  if (!cells || cells.length === 0) return out;
  const fields = new Map(schema.fields.map((f) => [f.name, f]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of cells) {
    // A line that's only a note gives the cell no formula (D57).
    if (c.expr === undefined) continue;
    const field = fields.get(c.field);
    const row = byId.get(c.id);
    if (!field || !row || c.field === "id") continue;
    if (!field.computed && !isEmptyValue(row[c.field])) continue;
    let mine = out.get(c.id);
    if (!mine) out.set(c.id, (mine = new Map()));
    if (!mine.has(c.field)) mine.set(c.field, c);
  }
  return out;
}

/** What a reader says of `cells/` lines it keeps but doesn't use: no row or field for them, a repeat, a value typed over one. */
export function cellDiagnostics(schema: TableSchema, rows: readonly Row[], cells: readonly CellFormula[] | undefined): ValidationError[] {
  const out: ValidationError[] = [];
  if (!cells) return out;
  const fields = new Map(schema.fields.map((f) => [f.name, f]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  cells.forEach((c, i) => {
    const field = fields.get(c.field);
    const row = byId.get(c.id);
    const where = `the formula of ${c.field} in row ${c.id}`;
    if (!row) out.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `${where} is kept, but there's no row ${c.id}` });
    else if (!field || c.field === "id") out.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `${where} is kept, but there's no field ${c.field}` });
    else if (seen.has(cellKey(c.id, c.field))) out.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `${where} is there twice; the first is used, and line ${i + 1} is kept` });
    else if (c.expr !== undefined && !field.computed && !isEmptyValue(row[c.field])) out.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `${where} has a value typed over it, which is used; the formula goes when the table is saved` });
    seen.add(cellKey(c.id, c.field));
  });
  return out;
}

/** One cell's line, keys in the canonical order: `id`, `field`, `expr`, `dialect`, then any others as they came. */
export function cellLine(c: CellFormula): string {
  const { id, field, expr, dialect, note, ...rest } = c;
  return JSON.stringify({ id, field, ...(expr === undefined ? {} : { expr }), ...(dialect === undefined ? {} : { dialect }), ...(note === undefined ? {} : { note }), ...rest });
}

/**
 * A table's `cells/` files as a writer writes them: in the rows' file
 * order, then the schema's field order; a line for no row or field it has
 * after, as read; lines that couldn't be read last. A value typed over a
 * stored field's formula wins, and that line goes. A new file is begun past
 * about 25 MB, named as rows files are (D51). None at all is no `cells/`.
 */
export function layoutCells(schema: TableSchema, rows: readonly Row[], cells: readonly CellFormula[] | undefined, unread: readonly string[] | undefined): { name: string; text: string }[] {
  if ((!cells || cells.length === 0) && (!unread || unread.length === 0)) return [];
  const fields = new Map(schema.fields.map((f, i) => [f.name, { field: f, at: i }]));
  const order = new Map(rows.map((r, i) => [r.id, { row: r, at: i }]));
  const placed: { line: string; row: number; field: number; read: number }[] = [];
  (cells ?? []).forEach((c, read) => {
    const r = order.get(c.id);
    const f = fields.get(c.field);
    // A value typed over a stored field's formula takes its place: the formula goes, a note stays (D57).
    let kept = c;
    if (c.expr !== undefined && r && f && !f.field.computed && !isEmptyValue(r.row[c.field])) {
      if (c.note === undefined) return;
      const { expr: _gone, dialect: _with, ...rest } = c;
      kept = rest as CellFormula;
    }
    placed.push({ line: cellLine(kept), row: r ? r.at : Infinity, field: f ? f.at : Infinity, read });
  });
  placed.sort((a, b) => a.row - b.row || a.field - b.field || a.read - b.read);
  const lines = [...placed.map((p) => p.line), ...(unread ?? [])];
  const files: { name: string; text: string }[] = [];
  let text = "";
  let bytes = 0;
  for (const line of lines) {
    text += `${line}\n`;
    bytes += utf8Length(line) + 1;
    if (bytes >= ROWS_FILE_BYTES) {
      files.push({ name: `${String(files.length + 1).padStart(4, "0")}.ndjson`, text });
      text = "";
      bytes = 0;
    }
  }
  if (text) files.push({ name: `${String(files.length + 1).padStart(4, "0")}.ndjson`, text });
  return files;
}
