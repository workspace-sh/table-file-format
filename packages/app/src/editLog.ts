// What was edited, kept for the app to append to a table's history
// (SPEC section 14, D44; table-core's edit-log makes the events). The
// reducer keeps it as edits are made: `tableApp` calls `recorded` after
// every action that edits rows or pages.
//
// (`history.ts` here is Back and Forward. This is the other history.)

import { pageChange, rowChanges, type CellFormula, type EditChange, type ParsedTable, type RowCells } from "@workspace.sh/table-core";

import type { IndexEdit } from "./indexed.ts";

/**
 * Edits made and not yet written to their tables' histories. Only kept
 * when the app says it writes them (`on`): nothing else empties it.
 */
export interface EditLogState {
  on: boolean;
  /** Each table's changes, oldest first, by its `bundle/table` key. */
  pending: Record<string, EditChange[]>;
  /**
   * Pages being changed, by table and row: the text as it was before the
   * first change of this stretch. The stretch becomes one `page` event
   * when it ends (the page is closed, or the app says it has been still),
   * as the spec asks: one for a burst of typing, not one a save.
   */
  pages: Record<string, Record<string, string>>;
}

export const NO_EDIT_LOG: EditLogState = { on: false, pending: {}, pages: {} };

/** The fields that aren't stored: formulas, lookups and rollups. */
const computedOf = (table: ParsedTable) => new Set(table.schema.fields.filter((f) => f.computed).map((f) => f.name));

/**
 * What changed in a table's rows, as history says it: in the order the
 * rows are now, then the rows that have gone. Rows are told apart by id,
 * so a row moved is not a change.
 */
export function rowsChanges(before: ParsedTable, after: ParsedTable): EditChange[] {
  if (before.rows === after.rows && before.cells === after.cells) return [];
  const computed = computedOf(after);
  const was = new Map(before.rows.map((row) => [row.id, row]));
  const cellsWere = cellsByRow(before.cells);
  const cellsNow = cellsByRow(after.cells);
  const changes: EditChange[] = [];
  for (const row of after.rows) {
    const old = was.get(row.id);
    was.delete(row.id);
    if (old !== row) {
      for (const change of rowChanges(old, row, computed)) {
        // A row added with cells' own formulas has them in its event (SPEC section 14).
        if (change.op === "insert" && cellsNow.has(row.id)) change.cells = cellsNow.get(row.id)!;
        changes.push(change);
      }
    }
    // Each cell's own formula set, changed or taken away (D52): one event each.
    if (old) {
      const before = cellsWere.get(row.id) ?? {};
      const now = cellsNow.get(row.id) ?? {};
      for (const field of new Set([...Object.keys(before), ...Object.keys(now)])) {
        const from = before[field]?.expr;
        const to = now[field]?.expr;
        if (from !== to) changes.push({ op: "formula", row: row.id, field, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) });
      }
    }
  }
  for (const gone of was.values()) {
    for (const change of rowChanges(gone, undefined, computed)) {
      if (change.op === "delete" && cellsWere.has(gone.id)) change.cells = cellsWere.get(gone.id)!;
      changes.push(change);
    }
  }
  return changes;
}

/** A table's cells' own formulas by row: each line without `id` and `field`, by the field's name, as history keeps them. */
function cellsByRow(cells: readonly CellFormula[] | undefined): Map<string, RowCells> {
  const out = new Map<string, RowCells>();
  for (const { id, field, ...rest } of cells ?? []) {
    let row = out.get(id);
    if (!row) out.set(id, (row = {}));
    row[field] ??= rest;
  }
  return out;
}

const withPending = (log: EditLogState, key: string, changes: EditChange[]): EditLogState =>
  changes.length === 0 ? log : { ...log, pending: { ...log.pending, [key]: [...(log.pending[key] ?? []), ...changes] } };

/**
 * The log after an edit took the tables from `before` to `after`. Rows
 * added, removed and changed are said at once. A page's change waits
 * while that page is open (`open`: the table and row), and is said once
 * it isn't.
 *
 * A change to a table's fields isn't recorded, nor what it does to the
 * rows (a field deleted, a choice removed): D44 leaves schema changes to
 * the writer, and this one records cells, rows and pages. Rows held in
 * an index aren't here to compare: the app says those as it makes them.
 */
export function recorded(
  log: EditLogState,
  before: Record<string, ParsedTable>,
  after: Record<string, ParsedTable>,
  open: { key: string; rowId: string } | null,
): EditLogState {
  if (!log.on) return log;
  let next = log;
  if (before !== after) {
    for (const [key, table] of Object.entries(after)) {
      const was = before[key];
      if (!was || was === table || was.schema !== table.schema) continue;
      if (!was.indexed && !table.indexed) next = withPending(next, key, rowsChanges(was, table));
      if (was.bodies !== table.bodies) {
        const started = { ...(next.pages[key] ?? {}) };
        let any = false;
        for (const rowId of new Set([...Object.keys(was.bodies ?? {}), ...Object.keys(table.bodies ?? {})])) {
          if (rowId in started || (was.bodies?.[rowId] ?? "") === (table.bodies?.[rowId] ?? "")) continue;
          started[rowId] = was.bodies?.[rowId] ?? "";
          any = true;
        }
        if (any) next = { ...next, pages: { ...next.pages, [key]: started } };
      }
    }
  }
  return settledPages(next, after, open);
}

/**
 * Edits made to rows held in an index, as history says them. The rows
 * aren't in the state to compare, so each is said from the edit itself and
 * the edit that undoes it (`back`, by the edit's `n`: what the index held
 * before, which only it knows). An edit that changed nothing has no
 * `back`, and says nothing. A page's edit is the state's to say, as any
 * table's page is.
 */
export function indexChanges(edits: readonly (IndexEdit & { n: number })[], back: Record<number, IndexEdit> | undefined): EditChange[] {
  const changes: EditChange[] = [];
  for (const edit of edits) {
    const undone = back?.[edit.n];
    if (edit.kind === "cell") {
      if (undone?.kind === "cell") changes.push(...rowChanges({ id: edit.rowId, [edit.field]: undone.value }, { id: edit.rowId, [edit.field]: edit.value }));
      // Typed over a cell's own formula: the formula goes, and the value is set (D52).
      if (undone?.kind === "formula") {
        changes.push({ op: "formula", row: edit.rowId, field: edit.field, ...(undone.expr === null ? {} : { from: undone.expr }) });
        changes.push(...rowChanges({ id: edit.rowId }, { id: edit.rowId, [edit.field]: edit.value }));
      }
    } else if (edit.kind === "formula") {
      if (undone?.kind === "formula") changes.push({ op: "formula", row: edit.rowId, field: edit.field, ...(undone.expr === null ? {} : { from: undone.expr }), ...(edit.expr === null ? {} : { to: edit.expr }) });
    } else if (edit.kind === "add") {
      // A new row is its id and nothing else.
      if (undone) changes.push({ op: "insert", row: edit.rowId, values: { id: edit.rowId } });
    } else if (edit.kind === "remove") {
      if (undone?.kind === "restore") changes.push({ op: "delete", row: edit.rowId, values: undone.row, ...(undone.cells ? { cells: rowCellsOf(undone.cells) } : {}) });
    } else if (edit.kind === "restore") {
      if (undone) changes.push({ op: "insert", row: edit.rowId, values: edit.row, ...(edit.cells ? { cells: rowCellsOf(edit.cells) } : {}) });
    }
  }
  return changes;
}

/** The log with a table's changes added, when the app writes history. */
export function logged(log: EditLogState, key: string, changes: EditChange[]): EditLogState {
  return log.on ? withPending(log, key, changes) : log;
}

/** A table that has gone (its file closed, the examples reset) takes what wasn't written with it. */
export function pruned(log: EditLogState, tables: Record<string, ParsedTable>): EditLogState {
  const gone = (record: Record<string, unknown>) => Object.keys(record).some((key) => !(key in tables));
  if (!gone(log.pending) && !gone(log.pages)) return log;
  const kept = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key in tables));
  return { ...log, pending: kept(log.pending), pages: kept(log.pages) };
}

/**
 * Pages whose stretch of changes is over, said: every one but the page
 * that is open (`open`; null for all of them). One that ended as it began
 * says nothing.
 */
export function settledPages(log: EditLogState, tables: Record<string, ParsedTable>, open: { key: string; rowId: string } | null): EditLogState {
  let next = log;
  for (const [key, started] of Object.entries(log.pages)) {
    const waiting: Record<string, string> = {};
    const changes: EditChange[] = [];
    for (const [rowId, from] of Object.entries(started)) {
      if (open?.key === key && open.rowId === rowId) {
        waiting[rowId] = from;
        continue;
      }
      const change = pageChange(rowId, from, tables[key]?.bodies?.[rowId]);
      if (change) changes.push(change);
    }
    if (Object.keys(waiting).length === Object.keys(started).length) continue;
    const { [key]: _, ...others } = next.pages;
    next = withPending({ ...next, pages: Object.keys(waiting).length > 0 ? { ...others, [key]: waiting } : others }, key, changes);
  }
  return next;
}

/** The log once the app has written the first `count` of a table's changes to its history. */
export function written(log: EditLogState, key: string, count: number): EditLogState {
  const pending = log.pending[key];
  if (!pending || count <= 0) return log;
  const { [key]: _, ...others } = log.pending;
  const left = pending.slice(count);
  return { ...log, pending: left.length > 0 ? { ...others, [key]: left } : others };
}

/** One row's cells' own formulas as history keeps them: each line without `id` and `field`, by the field's name. */
function rowCellsOf(cells: readonly CellFormula[]): RowCells {
  return cellsByRow(cells).values().next().value ?? {};
}
