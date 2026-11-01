/**
 * Computing formulas across a bundle's tables (D36, #123) and its Sheet
 * views' grids (D41) is the EDN core's (edn/, #638): one evaluator, in
 * Rust, on every platform, which an app sets with setFormulaEngine as it
 * starts (WebAssembly on the web, a native library on Linux, JSI on iOS and
 * the Mac). Nothing here works a formula out; what's here hands the core
 * the tables, puts its results in the rows, and says what doesn't read.
 */

import { FormulaError, parseExpr, type Expr, type Value } from "./expr.js";
import { applyFilters } from "./arrange.js";
import type { GridGroup } from "./grid.js";
import type { CellFormula, Field, ParsedTable, Row, TableSchema, ValidationError, View } from "./types.js";
import { cellFormulas } from "./cells.js";

/** What computing a table can see beyond its own rows (D36). */
export interface ComputeOptions {
  /**
   * The other tables `related` and `linked` read, keyed as a relation's
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
  /** This table's cells' own formulas (D52). Absent: its cells in `tables`, if it's there. */
  cells?: CellFormula[];
  /** What `today` and `now` read (D55): one moment for the whole computation. Absent: the time it's asked. */
  now?: Date;
  /** Where `rand` draws from (D55): the same seed, the same draws. Absent: a seed of the core's choosing. */
  seed?: number;
  /** Loops worked out by iteration (D60), as the table's meta asks. Absent: its meta's in `tables`, if it's there; else a loop is #REF!. */
  iteration?: { max: number; change: number };
}

type EngineTable = { schema: TableSchema; rows: readonly Row[]; views?: readonly View[]; cells?: readonly CellFormula[]; meta?: { iteration?: unknown } };

/** The evaluator: the EDN core, as `@workspace.sh/edn`'s `computeTables` and `computeGrids` give it. */
export interface FormulaEngine {
  computeTables(tables: Record<string, EngineTable>, clock?: { now?: Date; seed?: number }, only?: readonly string[]): Record<string, Record<string, unknown[]> | "host">;
  /** A Sheet view's grid, and with `columns` the table's formula columns in the same pass (as sheetGrid). */
  computeGrids(
    tables: Record<string, EngineTable>,
    table: string,
    views: readonly string[],
    options?: { now?: Date; seed?: number; columns?: boolean },
  ): { fields: Record<string, unknown[]>; grids: Record<string, { order: number[]; groups: GridGroup[]; loop: boolean } | null> } | "host";
}

let engine: FormulaEngine | null = null;

/** The evaluator formulas are worked out by from now on; null, none (formulas stay empty, and say why). */
export function setFormulaEngine(next: FormulaEngine | null): void {
  engine = next;
}

/** Whether an evaluator is set, so formulas are worked out. */
export function formulaEngineSet(): boolean {
  return engine !== null;
}

/** Said once of a table whose formulas wait for the core: the app hasn't loaded it (yet). */
const NO_ENGINE: ValidationError = { rowIndex: -1, message: "formulas aren't worked out: the formula core isn't loaded" };

/**
 * What doesn't read in a table's formulas, its fields' and its cells' own:
 * a dialect it doesn't know, or one that doesn't parse. Reported once each;
 * the cell is empty.
 */
function formulaDiagnostics(schema: TableSchema, rows: Row[], cells?: CellFormula[]): ValidationError[] {
  const diagnostics: ValidationError[] = [];
  const applying = cellFormulas(schema, rows, cells);
  if (applying.size > 0) {
    const at = new Map(rows.map((r, i) => [r.id, i]));
    for (const [id, byField] of applying) {
      const i = at.get(id)!;
      for (const [field, c] of byField) {
        if ((c.dialect ?? "table-expr-v1") !== "table-expr-v1") {
          diagnostics.push({ rowIndex: i, rowId: id, field, message: `unknown formula dialect ${String(c.dialect)}` });
          continue;
        }
        const r = parseExpr(c.expr!);
        if (!r.ok) diagnostics.push({ rowIndex: i, rowId: id, field, message: `formula doesn't parse (${r.message} at ${r.at}): ${c.expr}` });
      }
    }
  }
  for (const f of schema.fields) {
    if (!f.computed) continue;
    const { expr, dialect } = f.computed;
    if (dialect !== "table-expr-v1") {
      diagnostics.push({ rowIndex: -1, field: f.name, message: `unknown formula dialect ${dialect}` });
      continue;
    }
    const r = parseExpr(expr);
    if (!r.ok) diagnostics.push({ rowIndex: -1, field: f.name, message: `formula doesn't parse (${r.message} at ${r.at}): ${expr}` });
  }
  return diagnostics;
}

/** The moment and the seed the core is given. */
const clockOf = (options: ComputeOptions) => ({ ...(options.now ? { now: options.now } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}) });

/**
 * Rows with their computed fields filled in, for display and querying.
 * Results are never stored (SPEC section 2): callers hand these to views,
 * not to a writer, and the writer drops computed fields regardless.
 * An `expr` that doesn't parse leaves its field empty and is reported
 * once. A table with no computed fields returns the same array. With no
 * formula core set, its computed fields are empty, and that's said.
 */
export function computeRows(
  schema: TableSchema,
  rows: Row[],
  options: ComputeOptions = {},
): { rows: Row[]; diagnostics: ValidationError[] } {
  // Cells' own formulas (D52) fill their fields too; a table with any is worked out whole, without the memo.
  const cells = options.cells ?? (options.self !== undefined ? options.tables?.[options.self]?.cells : undefined);
  const withCells = cells !== undefined && cells.length > 0;
  const ownFields = withCells ? new Set(cells.map((c) => c.field)) : undefined;
  const computed = schema.fields.filter((f) => f.computed || ownFields?.has(f.name));
  if (computed.length === 0) return { rows, diagnostics: [] };
  if (!engine) return { rows, diagnostics: [NO_ENGINE, ...formulaDiagnostics(schema, rows, cells)] };
  const iterating = (iterationOf(options)?.max ?? 0) > 0;
  // Those that read only their own row keep a memo, so an edit computes one row.
  const memo = !withCells && !iterating && rowLocal(schema, computed) ? memoFor(schema) : undefined;
  const done = memo ? byEngineMemo(engine, schema, rows, options, computed, memo) : byEngine(engine, schema, rows, options, computed, cells);
  return done ?? { rows, diagnostics: [NO_ENGINE, ...formulaDiagnostics(schema, rows, cells)] };
}

/** How the table being computed works its loops out by iteration (D60), if it does. */
const iterationOf = (options: ComputeOptions): ComputeOptions["iteration"] =>
  options.iteration ?? (options.self !== undefined ? (options.tables?.[options.self]?.meta?.iteration as ComputeOptions["iteration"]) : undefined);

/** The engine's results as rows, or null when the table is this workbook's ("host"). */
function byEngine(
  e: FormulaEngine,
  schema: TableSchema,
  rows: Row[],
  options: ComputeOptions,
  computed: Field[],
  cells: CellFormula[] | undefined,
): { rows: Row[]; diagnostics: ValidationError[] } | null {
  // A table name is never empty (D37), so "" stands for a table not in `tables`.
  const self = options.self ?? "";
  const iteration = iterationOf(options);
  const tables = {
    ...options.tables,
    [self]: { schema, rows, views: options.views ?? options.tables?.[self]?.views ?? [], ...(cells ? { cells } : {}), meta: iteration ? { iteration } : {} },
  };
  const got = e.computeTables(tables, clockOf(options), [self])[self];
  if (!got || got === "host") return null;
  // A stored field takes a result only in the cells with a formula of their own (D52).
  const own = cells && cells.length > 0 ? cellFormulas(schema, rows, cells) : undefined;
  const out: Row[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const next: Row = { ...row };
    for (const f of computed) {
      if (!f.computed && !own?.get(row.id)?.has(f.name)) continue;
      const v = fromEngine(got[f.name]?.[i]);
      if (v === undefined) delete next[f.name];
      else next[f.name] = v;
    }
    out[i] = next;
  }
  return { rows: out, diagnostics: formulaDiagnostics(schema, rows, cells) };
}

/**
 * Formulas that read only their own row, by the engine: only the rows the memo doesn't have are sent,
 * which can't change what any of them gives. Null when the engine leaves them to this workbook.
 */
function byEngineMemo(
  e: FormulaEngine,
  schema: TableSchema,
  rows: Row[],
  options: ComputeOptions,
  computed: Field[],
  memo: { rows: WeakMap<Row, Row>; diagnostics?: ValidationError[] },
): { rows: Row[]; diagnostics: ValidationError[] } | null {
  const out: Row[] = new Array(rows.length);
  const fresh: Row[] = [];
  const at: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cached = memo.rows.get(rows[i]!);
    if (cached) out[i] = cached;
    else {
      fresh.push(rows[i]!);
      at.push(i);
    }
  }
  if (fresh.length > 0 || !memo.diagnostics) {
    const done = byEngine(e, schema, fresh, { ...clockOf(options), views: [] }, computed, undefined);
    if (!done) return null;
    for (let k = 0; k < fresh.length; k++) {
      memo.rows.set(fresh[k]!, done.rows[k]!);
      out[at[k]!] = done.rows[k]!;
    }
    memo.diagnostics ??= done.diagnostics;
  }
  return { rows: out, diagnostics: memo.diagnostics! };
}

/** An engine's result as this workbook's value: an error as a FormulaError, in lists too. */
function fromEngine(v: unknown): Value {
  if (Array.isArray(v)) return v.map(fromEngine) as Value;
  if (typeof v === "object" && v !== null && "code" in v) return new FormulaError((v as FormulaError).code, (v as FormulaError).message);
  return v as Value;
}

/**
 * Formulas that read only their own row's fields give the same answer for
 * the same row object, so an edit to one row of a million computes one row
 * (rows are never changed in place; an edit makes a new row). A formula
 * that reads across rows, tables or a Sheet view's places isn't, and the
 * table is computed whole each time.
 */
// So are the clock and chance (`today`, `now`, `rand`, D55): their answer isn't the row's alone, and changes.
const ACROSS_ROWS = new Set(["values", "related", "linked", "at", "range", "row", "rows", "today", "now", "rand"]);
const localSchemas = new WeakMap<TableSchema, boolean>();
const memos = new WeakMap<TableSchema, { rows: WeakMap<Row, Row>; diagnostics?: ValidationError[] }>();

function memoFor(schema: TableSchema) {
  let memo = memos.get(schema);
  if (!memo) memos.set(schema, (memo = { rows: new WeakMap() }));
  return memo;
}

export function rowLocal(schema: TableSchema, computed: Field[]): boolean {
  let local = localSchemas.get(schema);
  if (local === undefined) {
    const across = (e: Expr): boolean =>
      e.kind === "call" && (ACROSS_ROWS.has(e.fn) || (e.fn === "field" && e.args.length > 1) || e.args.some(across));
    local = computed.every((f) => {
      if (f.computed!.dialect !== "table-expr-v1") return true;
      const r = parseExpr(f.computed!.expr);
      return !r.ok || !across(r.expr);
    });
    localSchemas.set(schema, local);
  }
  return local;
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
 * isn't a Sheet view, or there's no formula core to work it out.
 */
export function sheetGrid(table: ParsedTable, viewId: string, options: ComputeOptions = {}): SheetGrid | null {
  return gridByEngine(table, viewId, options, true) ?? null;
}

/** A grid's numbers by row id, and the rows its saved filters, or a hand, hide: they keep their numbers (D58). */
function withHidden(table: ParsedTable, view: View, grid: Omit<SheetGrid, "position" | "hidden">): SheetGrid {
  const { rows } = grid;
  const position = new Map<string, number>();
  for (let p = 0; p < rows.length; p++) position.set(rows[p]!.id, p + 1);
  const hidden = new Set<string>();
  const filters = view.filter ?? [];
  for (const id of view.hidden ?? []) if (position.has(id)) hidden.add(id);
  if (filters.length > 0) {
    const shown = new Set(applyFilters(rows, filters, table.schema));
    for (const r of rows) if (!shown.has(r)) hidden.add(r.id);
  }
  return { ...grid, position, hidden };
}

/** The tables the engine is given for one of them: the rest of the bundle, and this one as `table` has it. */
function engineTables(table: ParsedTable, options: ComputeOptions, self: string) {
  const cells = options.cells ?? table.cells;
  return { ...options.tables, [self]: { schema: table.schema, rows: table.rows, views: options.views ?? table.views, ...(cells ? { cells } : {}), meta: {} } };
}

/**
 * A Sheet view's grid from the engine; with `fill`, its rows' computed fields too. Undefined when there's
 * no engine for it (none, chance given, or the table is the host's).
 */
function gridByEngine(table: ParsedTable, viewId: string, options: ComputeOptions, fill: true): SheetGrid | null | undefined;
function gridByEngine(table: ParsedTable, viewId: string, options: ComputeOptions, fill: false): { ids: string[]; loop: boolean } | null | undefined;
function gridByEngine(table: ParsedTable, viewId: string, options: ComputeOptions, fill: boolean): SheetGrid | { ids: string[]; loop: boolean } | null | undefined {
  if (!engine) return undefined;
  const self = options.self ?? "";
  const got = engine.computeGrids(engineTables(table, options, self), self, [viewId], { ...clockOf(options), columns: fill });
  if (got === "host") return undefined;
  const grid = got.grids[viewId];
  if (!grid) return null;
  if (!fill) return { ids: grid.order.map((i) => table.rows[i]!.id), loop: grid.loop };
  // Its computed fields, as sheetGrid fills them: the fields' formulas (not the cells' own).
  const computed = table.schema.fields.filter((f) => f.computed);
  const rows = grid.order.map((i) => {
    const row = table.rows[i]!;
    if (computed.length === 0) return row;
    const next: Row = { ...row };
    for (const f of computed) {
      const v = fromEngine(got.fields[f.name]?.[i]);
      if (v === undefined) delete next[f.name];
      else next[f.name] = v;
    }
    return next;
  });
  const view = (options.views ?? table.views).find((v) => v.id === viewId)!;
  return withHidden(table, view, { view: viewId, columns: view.fields ?? table.schema.fields.map((f) => f.name), rows, groups: grid.groups, loop: grid.loop });
}

/**
 * A Sheet view's row ids in grid order, without filling in the rows'
 * computed fields: what an app numbers rows by, and what formulas typed
 * in it count in (D41). Null when the view isn't a Sheet view, or there's
 * no formula core to work it out.
 */
export function sheetOrder(table: ParsedTable, viewId: string, options: ComputeOptions = {}): { ids: string[]; loop: boolean } | null {
  return gridByEngine(table, viewId, options, false) ?? null;
}
