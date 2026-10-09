import { applyGroup } from "./arrange.js";
import { viewTotal } from "./query.js";
import type { Row, TableSchema, ViewTotal } from "./types.js";

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

/** A group of a grouped view: its key as applyGroup gives it ("(empty)" for blank cells), its first place and its row count. */
export interface RowGroup {
  key: string;
  start: number;
  count: number;
}

/**
 * What a view reads its rows from, whether they are in memory or in the
 * index (LARGE-TABLES-PLAN section 1). A snapshot, as a RowSource is: an
 * edit, filter, sort or search gives a new one with a new `version`.
 *
 * Places count the rows in the order the view shows them: its sort or
 * manual order, and for a grouped view one group after another.
 */
export interface ViewRows extends RowSource {
  /** Rows the view shows before the viewer's search. */
  readonly inView: number;
  /** Changes whenever the answer could. */
  readonly version: string;
  /** Ids for a range of places, without the rows. */
  ids(start: number, end: number): string[] | Promise<string[]>;
  /** The place of a row, or -1 when the view doesn't show it. */
  placeOf(id: string): number | Promise<number>;
  /** A row the view shows, by id. */
  row(id: string): Row | undefined | Promise<Row | undefined>;
  /** The view's totals (SPEC section 4), by field: what viewTotal gives over every row shown. */
  totals(): Record<string, number | undefined> | Promise<Record<string, number | undefined>>;
  /** When the view groups: its groups in the order shown. Empty otherwise. */
  groups(): RowGroup[] | Promise<RowGroup[]>;
}

export interface ViewRowsOptions {
  /** Rows before the viewer's search; the rows given, when left out. */
  inView?: number;
  version?: string;
  /** The field the view groups by, and the schema that orders its groups. */
  group?: string;
  schema?: TableSchema;
  totals?: Record<string, ViewTotal>;
}

let memoryVersion = 0;

/** A ViewRows over rows already in memory, in the view's order (what applyView and searchRows return). */
export function memoryViewRows(rows: Row[], options: ViewRowsOptions = {}): ViewRows {
  const groups: RowGroup[] = [];
  let shown = rows;
  if (options.group !== undefined) {
    shown = [];
    for (const [key, members] of Object.entries(applyGroup(rows, options.group, options.schema))) {
      if (members.length === 0) continue;
      groups.push({ key, start: shown.length, count: members.length });
      for (const row of members) shown.push(row);
    }
  }
  let places: Map<string, number> | null = null;
  const placeOf = (id: string) => {
    if (!places) {
      places = new Map();
      for (let i = shown.length - 1; i >= 0; i--) places.set(shown[i]!.id, i);
    }
    return places.get(id) ?? -1;
  };
  const window = (start: number, end: number) => shown.slice(Math.max(0, start), Math.max(0, end));
  return {
    count: shown.length,
    inView: options.inView ?? shown.length,
    version: options.version ?? `m${++memoryVersion}`,
    rows: window,
    ids: (start, end) => window(start, end).map((r) => r.id),
    placeOf,
    row: (id) => shown[placeOf(id)],
    totals: () => Object.fromEntries(Object.entries(options.totals ?? {}).map(([field, kind]) => [field, viewTotal(shown, field, kind)])),
    groups: () => groups,
  };
}
