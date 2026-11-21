// What changed between two versions of a bundle, as plain values, and those
// changes applied to a bundle.
//
// For anything that keeps one `.table` in more than one place: git, a file
// sync service, a peer-to-peer log. Nothing here knows of any of them. The
// caller chooses the order changes are applied in; the same bundle and the
// same ordered changes always give the same bundle.
//
// A change names one cell, one row or one property, so edits to different
// ones all survive. Two edits to one cell: the later in the caller's order
// stands. A row deleted by one side and edited by the other is kept, with the
// edit: a delete says what it saw, and a row that has since differed, or that
// is edited after, comes back. No edit disappears without someone choosing it.

import type { BundleMeta, CellFormula, Field, ParsedBundle, ParsedTable, Row, View } from "./types.js";

/** A table's content, for a table added whole. */
export interface TableContent {
  schema: ParsedTable["schema"];
  rows: Row[];
  views: View[];
  meta: ParsedTable["meta"];
  bodies?: Record<string, string>;
  cells?: CellFormula[];
}

export type BundleChange =
  | { op: "set"; table: string; row: string; field: string; to?: unknown }
  | { op: "insert"; table: string; row: string; values: Row; after: string | null; page?: string; cells?: CellFormula[] }
  | { op: "delete"; table: string; row: string; values: Row; page?: string; cells?: CellFormula[] }
  | { op: "move"; table: string; row: string; after: string | null }
  | { op: "page"; table: string; row: string; to?: string }
  | { op: "cell"; table: string; row: string; field: string; to?: CellFormula }
  | { op: "field"; table: string; name: string; to?: Field }
  | { op: "field-order"; table: string; names: string[] }
  | { op: "view"; table: string; id: string; to?: View }
  | { op: "view-order"; table: string; ids: string[] }
  | { op: "meta"; table: string | null; key: string; to?: unknown }
  | { op: "schema"; table: string; key: string; to?: unknown }
  | { op: "table-add"; table: string; content: TableContent }
  | { op: "table-remove"; table: string };

/** A table whose rows aren't in memory (read later, or held in the index) can't be compared. */
export class RowsNotLoadedError extends Error {
  constructor(table: string) {
    super(`table "${table}" doesn't have its rows in memory`);
    this.name = "RowsNotLoadedError";
  }
}

/** Stamped by whoever edits, so it never counts as a change: it would conflict on every save. */
const UNCOMPARED_META = new Set(["modified_at"]);

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

/** JSON with its object keys sorted, so one value always reads the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    const source = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map(k => [k, source[k]]));
  }) ?? "undefined";
}

const same = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || canonical(a) === canonical(b);

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

const computedOf = (table: ParsedTable) => new Set(table.schema.fields.filter(f => f.computed).map(f => f.name));

function storedRow(row: Row, computed: ReadonlySet<string>): Row {
  const out: Row = { ...row };
  for (const name of computed) delete out[name];
  return out;
}

/** The line that applies for each cell: the first, when a merge has left two (D54). */
function cellLines(cells: readonly CellFormula[] | undefined): Map<string, CellFormula> {
  const out = new Map<string, CellFormula>();
  for (const line of cells ?? []) {
    const key = `${line.id}\u0000${line.field}`;
    if (!out.has(key)) out.set(key, line);
  }
  return out;
}

const cellsOfRow = (cells: readonly CellFormula[] | undefined, row: string) => (cells ?? []).filter(c => c.id === row);

function assertLoaded(name: string, table: ParsedTable): void {
  if (table.indexed || table.loading) throw new RowsNotLoadedError(name);
}

/** Indices of a longest increasing run in `values`: the rows that needn't move. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tails[low - 1]!;
    tails[low] = i;
  });
  const keep = new Set<number>();
  for (let at = tails.length > 0 ? tails[tails.length - 1]! : -1; at !== -1; at = previous[at]!) keep.add(at);
  return keep;
}

function diffProps(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: ReadonlySet<string>,
  make: (key: string, to: unknown) => BundleChange,
): BundleChange[] {
  const out: BundleChange[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (skip.has(key) || same(before[key], after[key])) continue;
    out.push(make(key, copy(after[key])));
  }
  return out;
}

function diffTable(name: string, before: ParsedTable, after: ParsedTable): BundleChange[] {
  assertLoaded(name, before);
  assertLoaded(name, after);
  const out: BundleChange[] = [];

  // Fields first, so a change to a new field's cells has its field.
  const beforeFields = new Map(before.schema.fields.map(f => [f.name, f]));
  const afterFields = new Map(after.schema.fields.map(f => [f.name, f]));
  for (const field of after.schema.fields) {
    if (!same(beforeFields.get(field.name), field)) out.push({ op: "field", table: name, name: field.name, to: copy(field) });
  }
  for (const fieldName of beforeFields.keys()) {
    if (!afterFields.has(fieldName)) out.push({ op: "field", table: name, name: fieldName });
  }
  const keptFields = before.schema.fields.map(f => f.name).filter(n => afterFields.has(n));
  const shownFields = after.schema.fields.map(f => f.name);
  if (!same(keptFields, shownFields.filter(n => beforeFields.has(n)))) {
    out.push({ op: "field-order", table: name, names: shownFields });
  }
  out.push(
    ...diffProps(before.schema, after.schema, new Set(["fields"]), (key, to) => ({
      op: "schema",
      table: name,
      key,
      ...(to === undefined ? {} : { to }),
    })),
  );

  const computed = new Set([...computedOf(before), ...computedOf(after)]);
  const beforeRows = new Map(before.rows.map(r => [r.id, r]));
  const afterRows = new Map(after.rows.map(r => [r.id, r]));

  for (const row of before.rows) {
    if (afterRows.has(row.id)) continue;
    const page = before.bodies?.[row.id];
    const cells = cellsOfRow(before.cells, row.id);
    out.push({
      op: "delete",
      table: name,
      row: row.id,
      values: copy(storedRow(row, computed)),
      ...(page === undefined ? {} : { page }),
      ...(cells.length ? { cells: copy(cells) } : {}),
    });
  }

  // Rows kept: those out of order move, after the row now before them.
  const beforeIndex = new Map(before.rows.map((r, i) => [r.id, i]));
  const kept = after.rows.filter(r => beforeRows.has(r.id));
  const staying = longestIncreasing(kept.map(r => beforeIndex.get(r.id)!));
  const movers = new Set(kept.filter((_, i) => !staying.has(i)).map(r => r.id));

  after.rows.forEach((row, i) => {
    const previous = i === 0 ? null : after.rows[i - 1]!.id;
    const old = beforeRows.get(row.id);
    if (old === undefined) {
      const page = after.bodies?.[row.id];
      const cells = cellsOfRow(after.cells, row.id);
      out.push({
        op: "insert",
        table: name,
        row: row.id,
        values: copy(storedRow(row, computed)),
        after: previous,
        ...(page === undefined ? {} : { page }),
        ...(cells.length ? { cells: copy(cells) } : {}),
      });
      return;
    }
    if (movers.has(row.id)) out.push({ op: "move", table: name, row: row.id, after: previous });
    for (const field of new Set([...Object.keys(row), ...Object.keys(old)])) {
      if (field === "id" || computed.has(field) || same(old[field], row[field])) continue;
      out.push({ op: "set", table: name, row: row.id, field, ...(isEmpty(row[field]) ? {} : { to: copy(row[field]) }) });
    }
    if (!same(before.bodies?.[row.id], after.bodies?.[row.id])) {
      const to = after.bodies?.[row.id];
      out.push({ op: "page", table: name, row: row.id, ...(to === undefined ? {} : { to }) });
    }
  });

  const beforeCells = cellLines(before.cells);
  const afterCells = cellLines(after.cells);
  for (const [key, line] of afterCells) {
    if (!beforeRows.has(line.id) || same(beforeCells.get(key), line)) continue;
    out.push({ op: "cell", table: name, row: line.id, field: line.field, to: copy(line) });
  }
  for (const [key, line] of beforeCells) {
    if (!afterRows.has(line.id) || afterCells.has(key)) continue;
    out.push({ op: "cell", table: name, row: line.id, field: line.field });
  }

  const beforeViews = new Map(before.views.map(v => [v.id, v]));
  const afterViews = new Map(after.views.map(v => [v.id, v]));
  for (const view of after.views) {
    if (!same(beforeViews.get(view.id), view)) out.push({ op: "view", table: name, id: view.id, to: copy(view) });
  }
  for (const id of beforeViews.keys()) if (!afterViews.has(id)) out.push({ op: "view", table: name, id });
  const keptViews = before.views.map(v => v.id).filter(id => afterViews.has(id));
  const shownViews = after.views.map(v => v.id);
  if (!same(keptViews, shownViews.filter(id => beforeViews.has(id)))) out.push({ op: "view-order", table: name, ids: shownViews });

  out.push(
    ...diffProps(before.meta as Record<string, unknown>, after.meta as Record<string, unknown>, UNCOMPARED_META, (key, to) => ({
      op: "meta",
      table: name,
      key,
      ...(to === undefined ? {} : { to }),
    })),
  );
  return out;
}

/** What changed from `before` to `after`, as values that can be stored or sent. */
export function diffBundle(before: ParsedBundle, after: ParsedBundle): BundleChange[] {
  const out: BundleChange[] = [];
  for (const [name, table] of Object.entries(after.tables)) {
    const old = before.tables[name];
    if (old !== undefined) {
      out.push(...diffTable(name, old, table));
      continue;
    }
    assertLoaded(name, table);
    const { schema, rows, views, meta, bodies, cells } = table;
    out.push({
      op: "table-add",
      table: name,
      content: copy({ schema, rows, views, meta, ...(bodies ? { bodies } : {}), ...(cells ? { cells } : {}) }),
    });
  }
  for (const name of Object.keys(before.tables)) if (!(name in after.tables)) out.push({ op: "table-remove", table: name });
  out.push(
    ...diffProps(before.meta as Record<string, unknown>, after.meta as Record<string, unknown>, UNCOMPARED_META, (key, to) => ({
      op: "meta",
      table: null,
      key,
      ...(to === undefined ? {} : { to }),
    })),
  );
  return out;
}

function placeAfter(rows: Row[], row: Row, after: string | null): void {
  const at = after === null ? -1 : rows.findIndex(r => r.id === after);
  // Its neighbour has gone: the end, the same place on every device.
  if (after !== null && at === -1) rows.push(row);
  else rows.splice(at + 1, 0, row);
}

function setProp(target: Record<string, unknown>, key: string, to: unknown): void {
  if (to === undefined) delete target[key];
  else target[key] = copy(to);
}

/** The bundle with these changes applied, in this order. The bundle given isn't changed. */
export function applyChanges(bundle: ParsedBundle, changes: readonly BundleChange[]): ParsedBundle {
  const out: ParsedBundle = { ...bundle, meta: { ...bundle.meta } as BundleMeta, tables: {} };
  for (const [name, table] of Object.entries(bundle.tables)) {
    if (changes.some(c => c.table === name)) assertLoaded(name, table);
    out.tables[name] = {
      ...table,
      schema: copy(table.schema),
      rows: table.rows.map(r => ({ ...r })),
      views: copy(table.views),
      meta: { ...table.meta },
      ...(table.bodies ? { bodies: { ...table.bodies } } : {}),
      ...(table.cells ? { cells: [...table.cells] } : {}),
    };
  }
  // Rows deleted so far, so an edit made without seeing the delete can bring one back.
  const removed = new Map<string, { values: Row; page?: string; cells?: CellFormula[] }>();
  const removedKey = (table: string, row: string) => `${table}\u0000${row}`;

  const rowFor = (table: ParsedTable, tableName: string, id: string): Row | undefined => {
    const found = table.rows.find(r => r.id === id);
    if (found) return found;
    const gone = removed.get(removedKey(tableName, id));
    if (!gone) return undefined;
    removed.delete(removedKey(tableName, id));
    const back = copy(gone.values);
    table.rows.push(back);
    if (gone.page !== undefined) (table.bodies ??= {})[id] = gone.page;
    if (gone.cells?.length) table.cells = [...(table.cells ?? []), ...copy(gone.cells)];
    return back;
  };

  for (const change of changes) {
    if (change.op === "meta" && change.table === null) {
      setProp(out.meta as Record<string, unknown>, change.key, change.to);
      continue;
    }
    const name = change.table as string;
    if (change.op === "table-add") {
      out.tables[name] = { ...copy(change.content), path: `${bundle.path}/tables/${name}` } as ParsedTable;
      continue;
    }
    if (change.op === "table-remove") {
      delete out.tables[name];
      continue;
    }
    const table = out.tables[name];
    if (table === undefined) continue;

    switch (change.op) {
      case "set": {
        const row = rowFor(table, name, change.row);
        if (row) setProp(row, change.field, change.to);
        break;
      }
      case "insert": {
        if (table.rows.some(r => r.id === change.row)) break;
        removed.delete(removedKey(name, change.row));
        placeAfter(table.rows, copy(change.values), change.after);
        if (change.page !== undefined) (table.bodies ??= {})[change.row] = change.page;
        if (change.cells?.length) table.cells = [...(table.cells ?? []), ...copy(change.cells)];
        break;
      }
      case "delete": {
        const at = table.rows.findIndex(r => r.id === change.row);
        if (at === -1) break;
        const row = table.rows[at]!;
        const computed = computedOf(table);
        // Changed since the deleting side saw it: that edit stands, and so does the row.
        if (!same(storedRow(row, computed), storedRow(change.values, computed))) break;
        if (!same(table.bodies?.[change.row], change.page)) break;
        const cells = cellsOfRow(table.cells, change.row);
        if (!same(cells, change.cells ?? [])) break;
        const page = table.bodies?.[change.row];
        removed.set(removedKey(name, change.row), {
          values: row,
          ...(page === undefined ? {} : { page }),
          ...(cells.length ? { cells } : {}),
        });
        table.rows.splice(at, 1);
        if (table.bodies) delete table.bodies[change.row];
        if (cells.length) table.cells = table.cells!.filter(c => c.id !== change.row);
        break;
      }
      case "move": {
        const at = table.rows.findIndex(r => r.id === change.row);
        if (at === -1) break;
        const [row] = table.rows.splice(at, 1);
        placeAfter(table.rows, row!, change.after);
        break;
      }
      case "page": {
        if (!rowFor(table, name, change.row)) break;
        if (change.to === undefined) {
          if (table.bodies) delete table.bodies[change.row];
        } else (table.bodies ??= {})[change.row] = change.to;
        break;
      }
      case "cell": {
        if (!rowFor(table, name, change.row)) break;
        const rest = (table.cells ?? []).filter(c => !(c.id === change.row && c.field === change.field));
        table.cells = change.to ? [...rest, copy(change.to)] : rest;
        break;
      }
      case "field": {
        const at = table.schema.fields.findIndex(f => f.name === change.name);
        if (change.to === undefined) {
          if (at !== -1) table.schema.fields.splice(at, 1);
        } else if (at === -1) table.schema.fields.push(copy(change.to));
        else table.schema.fields[at] = copy(change.to);
        break;
      }
      case "field-order": {
        const rank = new Map(change.names.map((n, i) => [n, i]));
        const ranked = (f: Field, i: number) => rank.get(f.name) ?? change.names.length + i;
        table.schema.fields = table.schema.fields
          .map((f, i) => [ranked(f, i), f] as const)
          .sort((a, b) => a[0] - b[0])
          .map(([, f]) => f);
        break;
      }
      case "view": {
        const at = table.views.findIndex(v => v.id === change.id);
        if (change.to === undefined) {
          if (at !== -1) table.views.splice(at, 1);
        } else if (at === -1) table.views.push(copy(change.to));
        else table.views[at] = copy(change.to);
        break;
      }
      case "view-order": {
        const rank = new Map(change.ids.map((id, i) => [id, i]));
        table.views = table.views
          .map((v, i) => [rank.get(v.id) ?? change.ids.length + i, v] as const)
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v);
        break;
      }
      case "meta":
        setProp(table.meta as Record<string, unknown>, change.key, change.to);
        break;
      case "schema":
        setProp(table.schema as Record<string, unknown>, change.key, change.to);
        break;
    }
  }
  return out;
}
