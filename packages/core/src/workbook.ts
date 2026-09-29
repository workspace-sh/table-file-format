/**
 * Computing formulas across a bundle's tables (D36, #123) and its Sheet
 * views' grids (D41). Every computed value is worked out once, keyed by
 * table, row and field, and so is every grid. A loop is caught per field:
 * a field that depends on itself, through any number of rows, tables or
 * grids, is #REF!. Nothing is read "as stored" to break a loop, so a
 * lookup of another table's rollup of this table computes, as it does in
 * a spreadsheet.
 *
 * Rows are named by their index in their table's file order, so reading a
 * computed value or a place in a grid is an array read, not a lookup: a
 * running total down a million rows reads a million places.
 */

import {
  evaluate,
  FormulaError,
  isEmpty,
  parseExpr,
  placeOf,
  type Expr,
  type Place,
  type PlaceRow,
  type Scope,
  type Value,
} from "./expr.js";
import { applyFilters } from "./arrange.js";
import { arrangeGrid, isSheet, sheetColumns, type GridGroup } from "./grid.js";
import type { Field, ParsedTable, Row, TableSchema, ValidationError, View } from "./types.js";

/** What computing a table can see beyond its own rows (D36). */
export interface ComputeOptions {
  /**
   * The other tables `lookup` and `linked` read, keyed as a relation's
   * `table` names them. Without them, those forms are #REF!.
   */
  tables?: Record<string, ParsedTable>;
  /** This table's key in `tables`. The rows handed in stand for it there. */
  self?: string;
  /**
   * This table's views, whose Sheet views formulas can read by place
   * (D41). Absent: its views in `tables`, if it's there.
   */
  views?: View[];
}

/** Something being worked out, and how deep in the stack it began. */
class Pending {
  constructor(readonly depth: number) {}
}

/** A computed value that is empty, told apart from one not worked out yet. */
const NONE = Symbol("empty");
type Slot = Value | Pending | typeof NONE;

/** One table as the workbook computes it: its fields, rows and per-table lists. */
interface Sheet {
  name: string;
  schema: TableSchema;
  rows: Row[];
  /** Row indexes by id, built when first needed. */
  byId?: Map<string, number>;
  known: Map<string, Field>;
  parsed: Map<string, Expr | null>;
  views: Map<string, View>;
  /**
   * Fields that read this table's own Sheet views by place: which view,
   * and whether they read only rows below (so are worked out bottom up).
   */
  places: Map<string, { view: string; forward: boolean }>;
  /** `(column "x")`: each field's values in file order, built once (D36). */
  columns: Map<string, Value[]>;
  /** For `linked`: this table's row indexes by the id each relation field points at, built once per relation. */
  backlinks: Map<string, Map<string, number[]>>;
  /** Computed values by field, then row index. */
  results: Map<string, (Slot | undefined)[]>;
  /** Grids by view id; `Pending` while being built. */
  grids: Map<string, Grid | FormulaError | Pending>;
  /** Place-reading fields already worked out down their grid. */
  warmed: Set<string>;
  diagnostics: ValidationError[];
}

function indexById(sheet: Sheet, id: string): number | undefined {
  if (!sheet.byId) {
    sheet.byId = new Map();
    for (let i = 0; i < sheet.rows.length; i++) sheet.byId.set(sheet.rows[i]!.id, i);
  }
  return sheet.byId.get(id);
}

/** A Sheet view's grid (D41). */
interface Grid {
  view: View;
  columns: string[];
  /** The file index of the row at each place: `order[0]` is row 1. */
  order: number[];
  /** Each row's place (from 1), by file index. */
  place: Int32Array;
  groups: GridGroup[];
  /** Sorted or grouped by its own places: numbered in file order, and every place read in it is #REF!. */
  looped: boolean;
}

function fileOrder(count: number): number[] {
  const order: number[] = new Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  return order;
}

/**
 * How deep formulas may nest before a chain of places, like a running
 * total, is worked out down its grid instead of by recursion, which would
 * overflow the stack on a long table.
 */
const MAX_DEPTH = 400;

/** Thrown past MAX_DEPTH, to unwind to the top and work `field` out down its grid. */
class DeepChain {
  constructor(
    readonly sheet: Sheet,
    readonly field: string,
  ) {}
}

class Workbook {
  private readonly sheets = new Map<string, Sheet | null>();
  /** What is being worked out, fields and grids, innermost last. A grid's entry notes a loop through it. */
  private readonly stack: ({ looped: boolean } | null)[] = [];
  private readonly pendings: Pending[] = [];

  constructor(
    private readonly tables: Record<string, ParsedTable>,
    private readonly self: { name: string; schema: TableSchema; rows: Row[]; views: View[] },
  ) {}

  /** A table by the name a relation or `linked` gives it, or null when it isn't there. */
  sheet(name: string): Sheet | null {
    if (this.sheets.has(name)) return this.sheets.get(name)!;
    const source = name === this.self.name ? this.self : this.tables[name];
    const sheet = source ? build(name, source.schema, source.rows, source.views ?? []) : null;
    this.sheets.set(name, sheet);
    return sheet;
  }

  private pending(): Pending {
    const depth = this.stack.length;
    return (this.pendings[depth] ??= new Pending(depth));
  }

  /** Row `i`'s value of field `name`. */
  value(sheet: Sheet, i: number, name: string): Value {
    const def = sheet.known.get(name);
    if (!def) return new FormulaError("#NAME?", `no field named ${name}`);
    if (!def.computed) return sheet.rows[i]![name] as Value;
    let slots = sheet.results.get(name);
    if (!slots) sheet.results.set(name, (slots = new Array(sheet.rows.length)));
    const got = slots[i];
    if (got !== undefined) {
      if (got === NONE) return undefined;
      if (got instanceof Pending) return this.loop(got.depth, new FormulaError("#REF!", `${name} depends on itself`));
      return got;
    }
    const expr = sheet.parsed.get(name);
    if (!expr) return undefined;
    if (this.stack.length > MAX_DEPTH && sheet.places.has(name) && !sheet.warmed.has(name)) {
      throw new DeepChain(sheet, name);
    }
    slots[i] = this.pending();
    this.stack.push(null);
    let v: Value;
    try {
      v = evaluate(expr, new RowScope(this, sheet, i));
    } catch (e) {
      slots[i] = undefined;
      throw e;
    } finally {
      this.stack.pop();
    }
    slots[i] = v === undefined ? NONE : v;
    return v;
  }

  /**
   * Work something out from the top. A long chain of places met on the
   * way unwinds to here, is worked out down its grid, and the work is
   * tried again.
   */
  top<T>(work: () => T): T {
    for (;;) {
      try {
        return work();
      } catch (e) {
        if (!(e instanceof DeepChain) || this.stack.length > 0) throw e;
        this.warm(e.sheet, e.field);
      }
    }
  }

  /** `value`, from the top. */
  topValue(sheet: Sheet, i: number, name: string): Value {
    for (;;) {
      try {
        return this.value(sheet, i, name);
      } catch (e) {
        if (!(e instanceof DeepChain) || this.stack.length > 0) throw e;
        this.warm(e.sheet, e.field);
      }
    }
  }

  /**
   * A field that reads its own Sheet view by place, worked out row by row
   * in that grid's order, so each row finds the one it reads done. Only
   * ever from the top, so it can't meet anything half worked out.
   */
  private warm(sheet: Sheet, name: string): void {
    sheet.warmed.add(name);
    const how = sheet.places.get(name)!;
    const grid = this.top(() => this.grid(sheet, how.view));
    const order = grid instanceof FormulaError ? fileOrder(sheet.rows.length) : grid.order;
    if (how.forward) for (let p = order.length - 1; p >= 0; p--) this.topValue(sheet, order[p]!, name);
    else for (const i of order) this.topValue(sheet, i, name);
  }

  /** A loop back to what began at `depth`: every grid being built since then is sorted by its own places. */
  private loop(depth: number, error: FormulaError): FormulaError {
    for (let i = depth; i < this.stack.length; i++) {
      const g = this.stack[i];
      if (g) g.looped = true;
    }
    return error;
  }

  /** A Sheet view of `sheet` as a grid, or #REF! when there's no such Sheet view (D41). */
  grid(sheet: Sheet, viewId: string): Grid | FormulaError {
    const done = sheet.grids.get(viewId);
    if (done instanceof Pending) {
      return this.loop(done.depth, new FormulaError("#REF!", `the Sheet view ${viewId} is sorted by its own places`));
    }
    if (done) return done;
    const view = sheet.views.get(viewId);
    if (!isSheet(view)) {
      const missing = new FormulaError("#REF!", `no Sheet view ${viewId}`);
      sheet.grids.set(viewId, missing);
      return missing;
    }
    const mark = { looped: false };
    sheet.grids.set(viewId, this.pending());
    this.stack.push(mark);
    let arranged: { order: number[]; groups: GridGroup[] };
    try {
      arranged = arrangeGrid(
        sheet.rows.length,
        view,
        sheet.schema,
        (i, f) => this.value(sheet, i, f),
        (i) => sheet.rows[i]!.id,
      );
    } catch (e) {
      sheet.grids.delete(viewId);
      throw e;
    } finally {
      this.stack.pop();
    }
    const order = mark.looped ? fileOrder(sheet.rows.length) : arranged.order;
    const place = new Int32Array(order.length);
    for (let p = 0; p < order.length; p++) place[order[p]!] = p + 1;
    const grid: Grid = {
      view,
      columns: sheetColumns(sheet.schema, view),
      order,
      place,
      groups: mark.looped ? [] : arranged.groups,
      looped: mark.looped,
    };
    sheet.grids.set(viewId, grid);
    return grid;
  }

  /** A corner's place in a grid: a number (maybe off the grid), null for an open end, or why it can't be read. */
  private corner(there: Sheet, here: boolean, grid: Grid, i: number, row: PlaceRow): number | null | FormulaError {
    if (row === null) return null;
    if (typeof row === "string") {
      const pinned = indexById(there, row);
      return pinned === undefined ? new FormulaError("#REF!", `no row ${row}`) : grid.place[pinned]!;
    }
    if (!here) return new FormulaError("#VALUE!", "another table's Sheet view is read by row id, not by offset");
    return grid.place[i]! + row;
  }

  /** Where a place is: its table, its grid, its rows top to bottom (possibly off the grid), and its fields. */
  private resolve(
    sheet: Sheet,
    i: number,
    p: Place,
  ): { there: Sheet; grid: Grid; top: number; bottom: number; fields: string[] } | FormulaError {
    const here = p.table === undefined || p.table === sheet.name;
    const there = here ? sheet : this.sheet(p.table!);
    if (!there) return new FormulaError("#REF!", `no table ${p.table}`);
    const grid = this.grid(there, p.view);
    if (grid instanceof FormulaError) return grid;
    if (grid.looped) return new FormulaError("#REF!", `the Sheet view ${p.view} is sorted by its own places`);
    if (!there.known.has(p.from.field)) return new FormulaError("#NAME?", `no field named ${p.from.field}`);
    if (!there.known.has(p.to.field)) return new FormulaError("#NAME?", `no field named ${p.to.field}`);
    const a = this.corner(there, here, grid, i, p.from.row);
    if (a instanceof FormulaError) return a;
    const b = p.single ? a : this.corner(there, here, grid, i, p.to.row);
    if (b instanceof FormulaError) return b;
    // Corners either way round name the same block. An open end runs to
    // the grid's edge on its side and is never swapped: "the top down to
    // the row above" is no rows at all in row 1.
    let top: number;
    let bottom: number;
    if (a === null || b === null) {
      top = a ?? 1;
      bottom = b ?? grid.order.length;
    } else {
      top = Math.min(a, b);
      bottom = Math.max(a, b);
    }
    let fields = [p.from.field];
    if (p.to.field !== p.from.field) {
      const f = grid.columns.indexOf(p.from.field);
      const t = grid.columns.indexOf(p.to.field);
      if (f === -1 || t === -1) {
        return new FormulaError("#REF!", `${f === -1 ? p.from.field : p.to.field} isn't a column of ${p.view}`);
      }
      fields = grid.columns.slice(Math.min(f, t), Math.max(f, t) + 1);
    }
    return { there, grid, top, bottom, fields };
  }

  place(sheet: Sheet, i: number, p: Place): Value {
    const r = this.resolve(sheet, i, p);
    if (r instanceof FormulaError) return r;
    const size = r.grid.order.length;
    if (p.single) return r.top < 1 || r.top > size ? undefined : this.value(r.there, r.grid.order[r.top - 1]!, r.fields[0]!);
    // Cells off the grid are empty, and every function that takes a list
    // skips empties, so the list holds only the cells on the grid.
    const out: Value[] = [];
    for (let at = Math.max(r.top, 1); at <= Math.min(r.bottom, size); at++) {
      const target = r.grid.order[at - 1]!;
      for (const f of r.fields) out.push(this.value(r.there, target, f));
    }
    return out;
  }

  where(sheet: Sheet, i: number, p: Place): { top: number; height: number; size: number } | FormulaError {
    const r = this.resolve(sheet, i, p);
    if (r instanceof FormulaError) return r;
    return { top: r.top, height: Math.max(r.bottom - r.top + 1, 0), size: r.grid.order.length };
  }

  column(sheet: Sheet, name: string): Value {
    if (!sheet.known.has(name)) return new FormulaError("#NAME?", `no field named ${name}`);
    let list = sheet.columns.get(name);
    if (!list) {
      list = [];
      for (let i = 0; i < sheet.rows.length; i++) list.push(this.value(sheet, i, name));
      sheet.columns.set(name, list);
    }
    return list;
  }

  linked(sheet: Sheet, i: number, table: string, relation: string, name: string): Value {
    const there = this.sheet(table);
    if (!there) return new FormulaError("#REF!", `no table ${table}`);
    let index = there.backlinks.get(relation);
    if (!index) {
      index = new Map();
      for (let j = 0; j < there.rows.length; j++) {
        const v = this.value(there, j, relation);
        for (const id of Array.isArray(v) ? v : [v]) {
          if (typeof id !== "string" || id === "") continue;
          const list = index.get(id);
          if (list) list.push(j);
          else index.set(id, [j]);
        }
      }
      there.backlinks.set(relation, index);
    }
    return (index.get(sheet.rows[i]!.id) ?? []).map((j) => this.value(there, j, name));
  }

  lookup(sheet: Sheet, i: number, relation: string, name: string): Value {
    const def = sheet.known.get(relation);
    if (!def) return new FormulaError("#NAME?", `no field named ${relation}`);
    if (!def.relation) return new FormulaError("#VALUE!", `${relation} doesn't link to another table`);
    const table = def.relation.table;
    const there = this.sheet(table);
    if (!there) return new FormulaError("#REF!", `no table ${table}`);
    const read = (id: unknown): Value => {
      if (isEmpty(id)) return undefined;
      const target = indexById(there, String(id));
      return target !== undefined ? this.value(there, target, name) : new FormulaError("#REF!", `no row ${String(id)} in ${table}`);
    };
    const v = this.value(sheet, i, relation);
    return Array.isArray(v) ? v.map(read) : read(v);
  }

  /** Row `i` with its computed fields filled in. */
  fill(sheet: Sheet, i: number, computed: Field[]): Row {
    const next: Row = { ...sheet.rows[i]! };
    for (const f of computed) {
      const v = this.topValue(sheet, i, f.name);
      if (v === undefined) delete next[f.name];
      else next[f.name] = v;
    }
    return next;
  }
}

/** What a formula computing one row can read (one object per row, not a closure per method). */
class RowScope implements Scope {
  constructor(
    private readonly book: Workbook,
    private readonly sheet: Sheet,
    private readonly i: number,
  ) {}
  field(name: string): Value {
    return this.book.value(this.sheet, this.i, name);
  }
  fieldOf(rowId: string, name: string): Value {
    const other = indexById(this.sheet, rowId);
    // A reference to a row that isn't there (deleted, say) is broken,
    // as a spreadsheet's is: shown, not silently empty.
    return other !== undefined ? this.book.value(this.sheet, other, name) : new FormulaError("#REF!", `no row ${rowId}`);
  }
  column(name: string): Value {
    return this.book.column(this.sheet, name);
  }
  lookup(relation: string, name: string): Value {
    return this.book.lookup(this.sheet, this.i, relation, name);
  }
  linked(table: string, relation: string, name: string): Value {
    return this.book.linked(this.sheet, this.i, table, relation, name);
  }
  place(p: Place): Value {
    return this.book.place(this.sheet, this.i, p);
  }
  where(p: Place) {
    return this.book.where(this.sheet, this.i, p);
  }
}

/** Which of this table's Sheet views a formula reads by place, if any, and whether only rows below. */
function placeUse(expr: Expr, table: string): { view: string; forward: boolean } | undefined {
  let view: string | undefined;
  let back = false;
  let forward = false;
  const walk = (e: Expr): void => {
    if (e.kind !== "call") return;
    if (e.fn === "at" || e.fn === "range") {
      const p = placeOf(e.fn, e.args);
      if (!(p instanceof FormulaError) && (p.table === undefined || p.table === table)) {
        view ??= p.view;
        for (const r of [p.from.row, p.to.row]) {
          if (typeof r === "number" && r < 0) back = true;
          if (typeof r === "number" && r > 0) forward = true;
        }
      }
    }
    e.args.forEach(walk);
  };
  walk(expr);
  return view === undefined ? undefined : { view, forward: forward && !back };
}

function build(name: string, schema: TableSchema, rows: Row[], views: View[]): Sheet {
  const diagnostics: ValidationError[] = [];
  const parsed = new Map<string, Expr | null>();
  const places = new Map<string, { view: string; forward: boolean }>();
  for (const f of schema.fields) {
    if (!f.computed) continue;
    const { expr, dialect } = f.computed;
    if (dialect !== "table-expr-v1") {
      diagnostics.push({ rowIndex: -1, field: f.name, message: `unknown formula dialect ${dialect}` });
      parsed.set(f.name, null);
      continue;
    }
    const r = parseExpr(expr);
    if (!r.ok) {
      diagnostics.push({ rowIndex: -1, field: f.name, message: `formula doesn't parse (${r.message} at ${r.at}): ${expr}` });
      parsed.set(f.name, null);
    } else {
      parsed.set(f.name, r.expr);
      const use = placeUse(r.expr, name);
      if (use) places.set(f.name, use);
    }
  }
  return {
    name,
    schema,
    rows,
    known: new Map(schema.fields.map((f) => [f.name, f])),
    parsed,
    views: new Map(views.map((v) => [v.id, v])),
    places,
    columns: new Map(),
    backlinks: new Map(),
    results: new Map(),
    grids: new Map(),
    warmed: new Set(),
    diagnostics,
  };
}

function workbookFor(schema: TableSchema, rows: Row[], options: ComputeOptions): { workbook: Workbook; sheet: Sheet } {
  // A table name is never empty (D37), so "" stands for a table not in `tables`.
  const self = options.self ?? "";
  const views = options.views ?? options.tables?.[self]?.views ?? [];
  const workbook = new Workbook(options.tables ?? {}, { name: self, schema, rows, views });
  return { workbook, sheet: workbook.sheet(self)! };
}

/**
 * Rows with their computed fields filled in, for display and querying.
 * Results are never stored (SPEC section 2): callers hand these to views,
 * not to a writer, and the writer drops computed fields regardless.
 * An `expr` that doesn't parse leaves its field empty and is reported
 * once. A table with no computed fields returns the same array.
 */
export function computeRows(
  schema: TableSchema,
  rows: Row[],
  options: ComputeOptions = {},
): { rows: Row[]; diagnostics: ValidationError[] } {
  const computed = schema.fields.filter((f) => f.computed);
  if (computed.length === 0) return { rows, diagnostics: [] };
  const { workbook, sheet } = workbookFor(schema, rows, options);
  const out: Row[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = workbook.fill(sheet, i, computed);
  return { rows: out, diagnostics: sheet.diagnostics };
}

/** A Sheet view as its grid (SPEC section 4, "Sheet views"; D41). */
export interface SheetGrid {
  /** The view's id. */
  view: string;
  /** Field names, lettered A, B, C… in this order. */
  columns: string[];
  /** Every row, computed fields filled in, in grid order: row 1 first. */
  rows: Row[];
  /** Each row's number in the grid, from 1, by id. */
  position: Map<string, number>;
  /** Rows the view's saved filters hide. They keep their numbers. */
  hidden: Set<string>;
  /** The saved grouping's groups, in order. Header lines aren't numbered. */
  groups: GridGroup[];
  /** Sorted or grouped by its own places: numbered in file order, and every place read in it is #REF!. */
  loop: boolean;
}

/**
 * A Sheet view's grid: what formulas count in, and what an app numbers
 * its rows by, whatever the reader's own sort (D41). Null when the view
 * isn't a Sheet view.
 */
export function sheetGrid(table: ParsedTable, viewId: string, options: ComputeOptions = {}): SheetGrid | null {
  const { workbook, sheet } = workbookFor(table.schema, table.rows, { views: table.views, ...options });
  const grid = workbook.top(() => workbook.grid(sheet, viewId));
  if (grid instanceof FormulaError) return null;
  const computed = table.schema.fields.filter((f) => f.computed);
  const rows = grid.order.map((i) => (computed.length === 0 ? sheet.rows[i]! : workbook.fill(sheet, i, computed)));
  const position = new Map<string, number>();
  for (let p = 0; p < rows.length; p++) position.set(rows[p]!.id, p + 1);
  const hidden = new Set<string>();
  const filters = grid.view.filter ?? [];
  if (filters.length > 0) {
    const shown = new Set(applyFilters(rows, filters));
    for (const r of rows) if (!shown.has(r)) hidden.add(r.id);
  }
  return { view: viewId, columns: grid.columns, rows, position, hidden, groups: grid.groups, loop: grid.looped };
}

/**
 * A Sheet view's row ids in grid order, without filling in the rows'
 * computed fields: what an app numbers rows by, and what formulas typed
 * in it count in (D41). Null when the view isn't a Sheet view.
 */
export function sheetOrder(table: ParsedTable, viewId: string, options: ComputeOptions = {}): { ids: string[]; loop: boolean } | null {
  const { workbook, sheet } = workbookFor(table.schema, table.rows, { views: table.views, ...options });
  const grid = workbook.top(() => workbook.grid(sheet, viewId));
  if (grid instanceof FormulaError) return null;
  return { ids: grid.order.map((i) => sheet.rows[i]!.id), loop: grid.looped };
}
