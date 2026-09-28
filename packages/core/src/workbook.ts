/**
 * Computing formulas across a bundle's tables (D36, #123). Every computed
 * value is worked out once, keyed by table, row and field, and a loop is
 * caught per field: a field that depends on itself, through any number of
 * rows or tables, is #REF!. Nothing is read "as stored" to break a loop,
 * so a lookup of another table's rollup of this table computes, as it
 * does in a spreadsheet.
 */

import { evaluate, FormulaError, isEmpty, parseExpr, type Expr, type Scope, type Value } from "./expr.js";
import type { Field, ParsedTable, Row, TableSchema, ValidationError } from "./types.js";

/** What computing a table can see beyond its own rows (D36). */
export interface ComputeOptions {
  /**
   * The other tables `lookup` and `linked` read, keyed as a relation's
   * `table` names them. Without them, those forms are #REF!.
   */
  tables?: Record<string, ParsedTable>;
  /** This table's key in `tables`. The rows handed in stand for it there. */
  self?: string;
}

/** One table as the workbook computes it: its fields, rows and per-table lists. */
interface Sheet {
  name: string;
  rows: Row[];
  byId: Map<string, Row>;
  known: Map<string, Field>;
  parsed: Map<string, Expr | null>;
  /** `(column "x")`: each field's values in file order, built once (D36). */
  columns: Map<string, Value[]>;
  /** For `linked`: this table's rows by the id each relation field points at, built once per relation. */
  backlinks: Map<string, Map<string, Row[]>>;
  diagnostics: ValidationError[];
}

class Workbook {
  private readonly sheets = new Map<string, Sheet | null>();
  private readonly results = new Map<string, Value>();
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly tables: Record<string, ParsedTable>,
    private readonly self: { name: string; schema: TableSchema; rows: Row[] },
  ) {}

  /** A table by the name a relation or `linked` gives it, or null when it isn't there. */
  sheet(name: string): Sheet | null {
    if (this.sheets.has(name)) return this.sheets.get(name)!;
    const source = name === this.self.name ? this.self : this.tables[name];
    const sheet = source ? build(name, source.schema, source.rows) : null;
    this.sheets.set(name, sheet);
    return sheet;
  }

  value(sheet: Sheet, row: Row, name: string): Value {
    const def = sheet.known.get(name);
    if (!def) return new FormulaError("#NAME?", `no field named ${name}`);
    if (!def.computed) return row[name] as Value;
    const key = `${sheet.name}\u0000${row.id}\u0000${name}`;
    if (this.results.has(key)) return this.results.get(key);
    if (this.inProgress.has(key)) return new FormulaError("#REF!", `${name} depends on itself`);
    const expr = sheet.parsed.get(name);
    if (!expr) return undefined;
    this.inProgress.add(key);
    const v = evaluate(expr, this.scope(sheet, row));
    this.inProgress.delete(key);
    this.results.set(key, v);
    return v;
  }

  private column(sheet: Sheet, name: string): Value {
    if (!sheet.known.has(name)) return new FormulaError("#NAME?", `no field named ${name}`);
    let list = sheet.columns.get(name);
    if (!list) {
      list = sheet.rows.map((r) => this.value(sheet, r, name));
      sheet.columns.set(name, list);
    }
    return list;
  }

  private linked(row: Row, table: string, relation: string, name: string): Value {
    const there = this.sheet(table);
    if (!there) return new FormulaError("#REF!", `no table ${table}`);
    let index = there.backlinks.get(relation);
    if (!index) {
      index = new Map();
      for (const r of there.rows) {
        const v = this.value(there, r, relation);
        for (const id of Array.isArray(v) ? v : [v]) {
          if (typeof id !== "string" || id === "") continue;
          const list = index.get(id);
          if (list) list.push(r);
          else index.set(id, [r]);
        }
      }
      there.backlinks.set(relation, index);
    }
    return (index.get(row.id) ?? []).map((r) => this.value(there, r, name));
  }

  private lookup(sheet: Sheet, row: Row, relation: string, name: string): Value {
    const def = sheet.known.get(relation);
    if (!def) return new FormulaError("#NAME?", `no field named ${relation}`);
    if (!def.relation) return new FormulaError("#VALUE!", `${relation} doesn't link to another table`);
    const table = def.relation.table;
    const there = this.sheet(table);
    if (!there) return new FormulaError("#REF!", `no table ${table}`);
    const read = (id: unknown): Value => {
      if (isEmpty(id)) return undefined;
      const target = there.byId.get(String(id));
      return target ? this.value(there, target, name) : new FormulaError("#REF!", `no row ${String(id)} in ${table}`);
    };
    const v = this.value(sheet, row, relation);
    return Array.isArray(v) ? v.map(read) : read(v);
  }

  scope(sheet: Sheet, row: Row): Scope {
    return {
      field: (name) => this.value(sheet, row, name),
      fieldOf: (rowId, name) => {
        const other = sheet.byId.get(rowId);
        // A reference to a row that isn't there (deleted, say) is broken,
        // as a spreadsheet's is: shown, not silently empty.
        return other ? this.value(sheet, other, name) : new FormulaError("#REF!", `no row ${rowId}`);
      },
      column: (name) => this.column(sheet, name),
      lookup: (relation, name) => this.lookup(sheet, row, relation, name),
      linked: (table, relation, name) => this.linked(row, table, relation, name),
    };
  }
}

function build(name: string, schema: TableSchema, rows: Row[]): Sheet {
  const diagnostics: ValidationError[] = [];
  const parsed = new Map<string, Expr | null>();
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
    }
  }
  return {
    name,
    rows,
    byId: new Map(rows.map((r) => [r.id, r])),
    known: new Map(schema.fields.map((f) => [f.name, f])),
    parsed,
    columns: new Map(),
    backlinks: new Map(),
    diagnostics,
  };
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
  // A table name is never empty (D37), so "" stands for a table not in `tables`.
  const workbook = new Workbook(options.tables ?? {}, { name: options.self ?? "", schema, rows });
  const sheet = workbook.sheet(options.self ?? "")!;
  const out = rows.map((row) => {
    const next: Row = { ...row };
    for (const f of computed) {
      const v = workbook.value(sheet, row, f.name);
      if (v === undefined) delete next[f.name];
      else next[f.name] = v;
    }
    return next;
  });
  return { rows: out, diagnostics: sheet.diagnostics };
}
