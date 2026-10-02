import type { Row } from "./types.js";

/**
 * The rows a view shows, as a screen reads them: how many there are, and
 * any window of them. A list draws from this instead of an array, so it
 * works the same whether the rows are in memory or in an index (SPEC
 * section 8). A source is a snapshot: a filter, a sort or an edit gives a
 * new one. Rows in it are never changed in place, so a row's id and
 * identity are stable keys.
 */
export interface RowSource {
  readonly count: number;
  /** The rows from `start` up to `end`, fewer at the end; synchronous for rows in memory. */
  rows(start: number, end: number): Row[] | Promise<Row[]>;
}

/** A source over rows already in memory (what applyView returns). */
export function arraySource(rows: Row[]): RowSource {
  return {
    count: rows.length,
    rows: (start, end) => rows.slice(Math.max(0, start), Math.max(0, end)),
  };
}
