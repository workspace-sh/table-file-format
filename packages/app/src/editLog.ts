// What was edited, kept for the app to append to a table's history
// (SPEC section 14, D44; table-core's edit-log makes the events). The
// reducer keeps it as edits are made: `tableApp` calls `recorded` after
// every action that edits rows or pages.
//
// (`history.ts` here is Back and Forward. This is the other history.)

import { pageChange, rowChanges, type EditChange, type ParsedTable } from "@workspace.sh/table-core";

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
  if (before.rows === after.rows) return [];
  const computed = computedOf(after);
  const was = new Map(before.rows.map((row) => [row.id, row]));
  const changes: EditChange[] = [];
  for (const row of after.rows) {
    const old = was.get(row.id);
    was.delete(row.id);
    if (old !== row) changes.push(...rowChanges(old, row, computed));
  }
  for (const gone of was.values()) changes.push(...rowChanges(gone, undefined, computed));
  return changes;
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
