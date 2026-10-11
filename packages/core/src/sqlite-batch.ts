import type { SqlValue } from "./indexer.js";

/** Bound values per statement: SQLite's limit is 32,766; this keeps each statement's work short. */
export const VALUES_PER_STATEMENT = 4_000;
/** `insert into t(a, b) values(?, ?)`: one row's insert, which a batch can repeat as `values(?, ?), (?, ?), …`. */
const ONE_ROW_INSERT = /^\s*insert\s+into\s+[^;]+?\bvalues\s*(\(\s*\?(?:\s*,\s*\?)*\s*\))\s*$/i;

/**
 * A one-row insert run for many rows as a few statements, each inserting as
 * many rows as fit in `perStatement` values: a crossing per few hundred rows
 * instead of one per row, for a driver whose every call crosses to native
 * code. Null when `sql` isn't a one-row insert, or the lists differ in
 * length: then each list is run on its own.
 */
export function manyRowInserts(sql: string, lists: SqlValue[][], perStatement = VALUES_PER_STATEMENT): { sql: string; params: SqlValue[] }[] | null {
  const tuple = ONE_ROW_INSERT.exec(sql)?.[1];
  const width = lists[0]?.length ?? 0;
  if (!tuple || width === 0 || lists.some((l) => l.length !== width)) return null;
  const per = Math.max(1, Math.floor(perStatement / width));
  const statements: { sql: string; params: SqlValue[] }[] = [];
  for (let at = 0; at < lists.length; at += per) {
    const part = lists.slice(at, at + per);
    statements.push({ sql: sql.slice(0, sql.lastIndexOf(tuple)) + Array.from(part, () => tuple).join(", "), params: part.flat() });
  }
  return statements;
}
