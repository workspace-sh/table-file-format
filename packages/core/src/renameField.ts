// Renaming a field (SPEC section 2): its `name` is the key its values have
// in every row and the word formulas read it by, so a rename is that name
// rewritten everywhere it's used. Its `id` stays as it was, which is what
// lets an address made before the rename still find it.

import { parseExpr, type Expr } from "./expr.js";
import { formatExpr } from "./formula.js";
import type { CellFormula, ParsedTable, Row, View, ViewFilter } from "./types.js";

/** Why `to` can't be the new name of `from` in `table`, or null when it can. */
export function renameProblem(table: Pick<ParsedTable, "schema">, from: string, to: string): string | null {
  if (!table.schema.fields.some((f) => f.name === from)) return `There's no field “${from}”.`;
  if (to.trim() === "") return "A field needs a name.";
  if (to !== to.trim()) return "A name can't begin or end with a space.";
  if (to === "id") return "“id” is every row's own id.";
  if (to !== from && table.schema.fields.some((f) => f.name === to)) return `There's already a field “${to}”.`;
  return null;
}

/**
 * The tables of one `.table` (by name, as relations and formulas name
 * them) with field `from` of `table` renamed `to`: in its table's schema,
 * rows, views and cells; in every formula that reads it, in its own table
 * or another (`related`, `linked`, `at`, `range`); and in every relation
 * that points at it. Tables it changes nothing in are returned as they
 * were. A formula is rewritten only when it reads the field, in the stored
 * form's canonical spelling; one in another dialect is left as it is.
 */
export function renameField(tables: Record<string, ParsedTable>, table: string, from: string, to: string): Record<string, ParsedTable> {
  const own = tables[table];
  if (!own || from === to || renameProblem(own, from, to) !== null) return tables;
  // Which of another table's relation fields point at this one: through them, `related` reads its fields.
  const pointing = (t: ParsedTable) => new Set(t.schema.fields.filter((f) => f.relation?.table === table).map((f) => f.name));
  const out: Record<string, ParsedTable> = {};
  for (const [name, t] of Object.entries(tables)) {
    const here = name === table;
    const rename: Renaming = { from, to, here, table, relations: pointing(t) };
    out[name] = here ? renamedHere(t, from, to, rename) : renamedElsewhere(t, rename);
  }
  return out;
}

interface Renaming {
  from: string;
  to: string;
  /** The formula is in the renamed field's own table. */
  here: boolean;
  /** The renamed field's table's name. */
  table: string;
  /** The formula's table's relation fields that point at the renamed field's table. */
  relations: Set<string>;
}

function renamedHere(t: ParsedTable, from: string, to: string, rename: Renaming): ParsedTable {
  const fields = t.schema.fields.map((f) => {
    let next = f.name === from ? { ...f, name: to } : f;
    // A relation of this table's to itself, keyed by the renamed field.
    if (next.relation?.table === rename.table && next.relation.field === from) next = { ...next, relation: { ...next.relation, field: to } };
    return formulaOf(next, rename);
  });
  const primaryKey = t.schema.primaryKey?.map((k) => (k === from ? to : k));
  const schema = { ...t.schema, fields, ...(primaryKey ? { primaryKey } : {}) };
  const rows = t.rows.map((r) => (from in r ? renamedKey(r, from, to) : r));
  const cells = t.cells?.map((c) => cellOf(c.field === from ? { ...c, field: to } : c, rename));
  return { ...t, schema, rows, views: t.views.map((v) => viewWithRename(v, from, to)), ...(cells ? { cells } : {}) };
}

function renamedElsewhere(t: ParsedTable, rename: Renaming): ParsedTable {
  let changed = false;
  const fields = t.schema.fields.map((f) => {
    let next = f;
    if (f.relation?.table === rename.table && f.relation.field === rename.from) next = { ...f, relation: { ...f.relation, field: rename.to } };
    next = formulaOf(next, rename);
    if (next !== f) changed = true;
    return next;
  });
  const cells = t.cells?.map((c) => {
    const next = cellOf(c, rename);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...t, schema: { ...t.schema, fields }, ...(cells ? { cells } : {}) } : t;
}

function formulaOf<F extends { computed?: { dialect?: string; expr: string } }>(f: F, rename: Renaming): F {
  if (!f.computed || (f.computed.dialect ?? "table-expr-v1") !== "table-expr-v1") return f;
  const expr = renamedFormula(f.computed.expr, rename);
  return expr === f.computed.expr ? f : { ...f, computed: { ...f.computed, expr } };
}

function cellOf(c: CellFormula, rename: Renaming): CellFormula {
  if (c.expr === undefined || (c.dialect ?? "table-expr-v1") !== "table-expr-v1") return c;
  const expr = renamedFormula(c.expr, rename);
  return expr === c.expr ? c : { ...c, expr };
}

/** A stored formula with the field renamed where it reads it; as it was, to the byte, where it doesn't (or can't be read). */
function renamedFormula(src: string, rename: Renaming): string {
  const parsed = parseExpr(src);
  if (!parsed.ok) return src;
  let touched = false;
  const name = (value: string): string => {
    if (value !== rename.from) return value;
    touched = true;
    return rename.to;
  };
  const walk = (e: Expr): Expr => {
    if (e.kind === "field") return rename.here && e.name === rename.from ? { kind: "field", name: name(e.name) } : e;
    if (e.kind !== "call") return e;
    const args = e.args.map(walk);
    // Read from the formula as written: which relation, which table.
    const written = (i: number) => (e.args[i]?.kind === "string" ? (e.args[i] as { value: string }).value : undefined);
    const rewrite = (i: number) => {
      const arg = args[i];
      if (arg?.kind === "string") args[i] = { kind: "string", value: name(arg.value) };
    };
    const fn = e.fn.toLowerCase();
    if (fn === "field" || fn === "values" || fn === "column") {
      if (rename.here) rewrite(0);
    } else if (fn === "related" || fn === "lookup") {
      // (related "relation" "its field"): the relation is this table's; its field, the table it points at.
      if (rename.here) rewrite(0);
      const relation = written(0);
      if (relation !== undefined && rename.relations.has(relation)) rewrite(1);
    } else if (fn === "linked") {
      // (linked "table" "its relation field" "its field"): both fields are that table's.
      if (written(0) === rename.table) {
        rewrite(1);
        rewrite(2);
      }
    } else if (fn === "at" || fn === "range") {
      // A place: its fields are the formula's own table's, or those of the table named last.
      const named = written(fn === "at" ? 3 : 5);
      if (named !== undefined ? named === rename.table : rename.here) {
        rewrite(0);
        if (fn === "range") rewrite(2);
      }
    }
    return { kind: "call", fn: e.fn, args };
  };
  const next = walk(parsed.expr);
  return touched ? formatExpr(next) : src;
}

function renamedKey(row: Row, from: string, to: string): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k === from ? to : k] = v;
  return out as Row;
}

function filtersWithRename(filters: ViewFilter[], from: string, to: string): ViewFilter[] {
  return filters.map((f) => (f.field === from ? { ...f, field: to } : f));
}

function keysWithRename<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in record)) return record;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) out[k === from ? to : k] = v;
  return out;
}

function viewWithRename(view: View, from: string, to: string): View {
  const next: View = { ...view };
  const one = (name: string) => (name === from ? to : name);
  if (view.fields) next.fields = view.fields.map(one);
  if (view.sort) next.sort = view.sort.map((s) => (s.field === from ? { ...s, field: to } : s));
  if (view.filter) next.filter = filtersWithRename(view.filter, from, to);
  if (view.group) next.group = { ...view.group, field: one(view.group.field) };
  if (view.columnWidths) next.columnWidths = keysWithRename(view.columnWidths, from, to);
  if (view.totals) next.totals = keysWithRename(view.totals, from, to);
  if (Array.isArray(view.colors)) {
    next.colors = view.colors.map((r) => ({ ...r, filter: filtersWithRename(r.filter, from, to), ...(r.field !== undefined ? { field: one(r.field) } : {}) }));
  }
  if (view.merged) {
    next.merged = view.merged.map((m) => ({ from: { ...m.from, field: one(m.from.field) }, to: { ...m.to, field: one(m.to.field) } }));
  }
  if (view.calendar_range) next.calendar_range = { start: one(view.calendar_range.start), end: one(view.calendar_range.end) };
  for (const k of ["board_field", "gallery_field", "calendar_field"] as const) if (view[k] === from) next[k] = to;
  return next;
}
