// Applying a fix a person chose from a table's problems (problems.ts): the
// table as it is after it, as a pure function, so an app makes it one edit
// that undoes, saves and syncs like any other.
//
// The reader's diagnostics are what it said at read time, and a problem of a
// kept line or a reader's note is listed from them: a fix that resolves one
// takes its diagnostic with it, found by the same file and line (or cell, or
// field) the fix names. Lines keep the numbers they were read at until the
// table is read again, so they stay a line's name, not its place.

import { newId } from "./id.js";
import type { Fix } from "./problems.js";
import type { CellFormula, Field, ParsedTable, Row, TableSchema, UnreadLine, ValidationError } from "./types.js";

/** The kinds `applyFix` makes; the others need a file outside the table, or a person's pick. */
const APPLIED: ReadonlySet<Fix["kind"]> = new Set([
  "set-value",
  "clear-value",
  "change-field",
  "change-schema",
  "choose-line",
  "keep-as-new-row",
  "remove-line",
  "remove-formula",
  "give-field-new-id",
]);

/** Whether `applyFix` can make this fix by itself. */
export function canApplyFix(fix: Fix): boolean {
  return APPLIED.has(fix.kind);
}

/** The table after `fix`. Throws for a kind `canApplyFix` says no to. */
export function applyFix(table: ParsedTable, fix: Fix): ParsedTable {
  switch (fix.kind) {
    case "set-value":
      return withValue(table, fix.row, fix.field, fix.value);
    case "clear-value":
      return withoutDiagnostics(withValue(table, fix.row, fix.field, undefined), (d) => d.code === "cell.typed-over" && d.rowId === fix.row && d.field === fix.field);
    case "change-field":
      return { ...table, schema: { ...table.schema, fields: table.schema.fields.map((f) => (f.name === fix.field ? changedField(f, fix.change) : f)) } };
    case "change-schema":
      return { ...table, schema: merged(table.schema, fix.change) as TableSchema };
    case "remove-line":
      return withoutLine(table, fix.file, fix.line).table;
    case "keep-as-new-row": {
      const { table: without, text, after } = withoutLine(table, fix.file, fix.line);
      const parsed = rowOf(text);
      if (!parsed) return without;
      const row: Row = { ...parsed, id: newId() };
      return { ...without, rows: inserted(without.rows, row, after) };
    }
    case "choose-line": {
      const { table: without, text } = withoutLine(table, fix.file, fix.line);
      const chosen = rowOf(text);
      if (!chosen || typeof chosen.id !== "string") return without;
      const at = without.rows.findIndex((r) => r.id === chosen.id);
      if (at < 0) return { ...without, rows: [...without.rows, chosen as Row] };
      // The row read first is kept as a line, as the chosen one was: a person removes it or keeps it as a row of its own.
      const before = without.rows[at]!;
      const rows = without.rows.map((r, i) => (i === at ? (chosen as Row) : r));
      const kept: UnreadLine = { after: chosen.id, text: JSON.stringify(before) };
      const said: ValidationError = {
        rowIndex: fix.line,
        file: fix.file,
        text: kept.text,
        rowId: chosen.id,
        code: "line.id-repeated",
        message: `${fix.file}: line ${fix.line + 1} repeats the id "${chosen.id}" of a row before it, and is kept as it is`,
      };
      return { ...without, rows, unread: [...(without.unread ?? []), kept], diagnostics: [...(without.diagnostics ?? []), said] };
    }
    case "remove-formula": {
      const same = (c: CellFormula) => c.id === fix.row && c.field === fix.field;
      let seen = false;
      const cells = (table.cells ?? []).filter((c) => {
        if (!same(c)) return true;
        if (fix.repeats && !seen) return (seen = true);
        return false;
      });
      const code = fix.repeats ? "cell.repeated" : undefined;
      return withoutDiagnostics({ ...table, cells }, (d) => d.rowId === fix.row && d.field === fix.field && (code ? d.code === code : d.code === "cell.typed-over" || d.code === "cell.repeated"));
    }
    case "give-field-new-id":
      // The reader gave it one already, which saving keeps: what's left is to stop saying so.
      return withoutDiagnostics(table, (d) => d.code === "field.id-repeated" && d.field === fix.field);
    default:
      throw new Error(`a fix of kind ${fix.kind} isn't made by applyFix`);
  }
}

/** The table after each of `fixes` in turn: a choice that resolves several problems at once, made as one edit. */
export function applyFixes(table: ParsedTable, fixes: readonly Fix[]): ParsedTable {
  return fixes.reduce(applyFix, table);
}

function withValue(table: ParsedTable, rowId: string, field: string, value: unknown): ParsedTable {
  let changed = false;
  const rows = table.rows.map((r) => {
    if (r.id !== rowId) return r;
    changed = true;
    const next: Row = { ...r };
    if (value === undefined) delete next[field];
    else next[field] = value;
    return next;
  });
  return changed ? { ...table, rows } : table;
}

/** `base` with `change` merged in: a member set to `undefined` is removed. */
function merged<T extends object>(base: T, change: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

function changedField(field: Field, change: Partial<Field>): Field {
  const { constraints, ...rest } = change;
  const next = merged(field, rest);
  if (constraints === undefined) return "constraints" in change ? merged(next, { constraints: undefined }) : next;
  const c = merged(field.constraints ?? {}, constraints);
  return Object.keys(c).length > 0 ? { ...next, constraints: c } : merged(next, { constraints: undefined });
}

function withoutDiagnostics(table: ParsedTable, gone: (d: ValidationError) => boolean): ParsedTable {
  if (!table.diagnostics?.some(gone)) return table;
  const diagnostics = table.diagnostics.filter((d) => !gone(d));
  return diagnostics.length > 0 ? { ...table, diagnostics } : merged(table, { diagnostics: undefined });
}

/** The table without the kept line `file`'s `line`, and what that line said and where it was kept. */
function withoutLine(table: ParsedTable, file: string, line: number): { table: ParsedTable; text: string; after: string | null } {
  const said = table.diagnostics?.find((d) => d.file === file && d.rowIndex === line && d.text !== undefined);
  if (!said) return { table, text: "", after: null };
  const text = said.text!;
  const without = withoutDiagnostics(table, (d) => d === said);
  if (file.startsWith("cells/")) {
    const at = (without.unreadCells ?? []).indexOf(text);
    if (at < 0) return { table: without, text, after: null };
    return { table: { ...without, unreadCells: without.unreadCells!.filter((_, i) => i !== at) }, text, after: null };
  }
  const at = (without.unread ?? []).findIndex((u) => u.text === text);
  if (at < 0) return { table: without, text, after: null };
  const after = without.unread![at]!.after;
  return { table: { ...without, unread: without.unread!.filter((_, i) => i !== at) }, text, after };
}

function rowOf(text: string): (Row & Record<string, unknown>) | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
  } catch {
    return null;
  }
}

/** `rows` with `row` put after the row `after` (first when null, last when that row is gone). */
function inserted(rows: readonly Row[], row: Row, after: string | null): Row[] {
  if (after === null) return [row, ...rows];
  const at = rows.findIndex((r) => r.id === after);
  return at < 0 ? [...rows, row] : [...rows.slice(0, at + 1), row, ...rows.slice(at + 1)];
}
