/**
 * table-expr-v1 — the computed-field dialect (DECISIONS D29, SPEC
 * section 2 "Computed fields"). A reader and a row-local evaluator.
 *
 * Grammar: `(function arg …)`; numbers and strings as in JSON; `true`,
 * `false`; `nil`, an open end of a range (D41); a bare word is a field of
 * the same row, and `(field "any name")` reaches one whose name isn't a
 * bare word (`nil` among them).
 * Function names are read case-insensitively; field names are not.
 *
 * Values follow the spreadsheet conventions people already know: an
 * empty operand makes arithmetic empty, while `sum` / `min` / `max`
 * skip empties; failures are error values that show a spreadsheet code
 * (`#DIV/0!`) and pass through whatever uses them. Pure TypeScript,
 * no platform APIs — it runs wherever table-core does. Computing a
 * table's rows, across rows and tables, is workbook.ts.
 */

export type FormulaErrorCode = "#DIV/0!" | "#VALUE!" | "#NAME?" | "#REF!" | "#NUM!";

/** A formula's failure, as a value. Renders as its code. */
export class FormulaError {
  constructor(
    readonly code: FormulaErrorCode,
    readonly message: string,
  ) {}
  toString(): string {
    return this.code;
  }
}

export type Expr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "nil" }
  | { kind: "field"; name: string }
  | { kind: "call"; fn: string; args: Expr[] };

export type ParseResult = { ok: true; expr: Expr } | { ok: false; message: string; at: number };

// ---- reader

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WORD = /^[^\s()"]+/;

/** Read a stored `expr`. Anything but one complete expression is refused. */
export function parseExpr(src: string): ParseResult {
  let pos = 0;
  const skip = () => {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++;
  };
  const fail = (message: string): never => {
    throw { message, at: pos };
  };
  const read = (): Expr => {
    skip();
    if (pos >= src.length) fail("unexpected end of expression");
    const c = src[pos]!;
    if (c === "(") {
      pos++;
      skip();
      const head = WORD.exec(src.slice(pos));
      if (!head) fail("expected a function name after (");
      pos += head![0].length;
      const args: Expr[] = [];
      for (;;) {
        skip();
        if (pos >= src.length) fail("missing )");
        if (src[pos] === ")") {
          pos++;
          break;
        }
        args.push(read());
      }
      return { kind: "call", fn: head![0].toLowerCase(), args };
    }
    if (c === ")") fail("unexpected )");
    if (c === '"') {
      // A JSON string: let JSON.parse do the escapes.
      let end = pos + 1;
      while (end < src.length && src[end] !== '"') end += src[end] === "\\" ? 2 : 1;
      if (end >= src.length) fail("unterminated string");
      const value = JSON.parse(src.slice(pos, end + 1)) as string;
      pos = end + 1;
      return { kind: "string", value };
    }
    const num = NUMBER.exec(src.slice(pos));
    if (num && !WORD.test(src.slice(pos + num[0].length, pos + num[0].length + 1))) {
      pos += num[0].length;
      return { kind: "number", value: Number(num[0]) };
    }
    const word = WORD.exec(src.slice(pos))!;
    pos += word[0].length;
    if (word[0] === "true" || word[0] === "false") return { kind: "boolean", value: word[0] === "true" };
    if (word[0] === "nil") return { kind: "nil" };
    return { kind: "field", name: word[0] };
  };
  try {
    const expr = read();
    skip();
    if (pos < src.length) fail("unexpected text after the expression");
    return { ok: true, expr };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, message: "malformed string", at: pos };
    const { message, at } = e as { message: string; at: number };
    return { ok: false, message, at };
  }
}

// ---- evaluator

type Scalar = number | string | boolean | undefined | FormulaError;
/** A list comes from reading across rows: `column`, `linked`, or a many `lookup` (D36). */
export type Value = Scalar | Value[];

export const isEmpty = (v: unknown): v is undefined => v === undefined || v === null || v === "";

/** A list's items, lists within it opened out. */
function flatten(vs: Value[]): Scalar[] {
  const out: Scalar[] = [];
  for (const v of vs) {
    if (Array.isArray(v)) out.push(...flatten(v));
    else out.push(v);
  }
  return out;
}

/** What a formula can read: its row, other rows, and other tables (workbook.ts). */
export interface Scope {
  /** A field of the row being computed. */
  field(name: string): Value;
  /** A field of another row, by its system id (D34). */
  fieldOf(rowId: string, name: string): Value;
  /** Every row's value of a field of this table, in file order (D36). */
  column(name: string): Value;
  /** Follow this row's relation field to its target row(s) and read a field there (D36). */
  lookup(relation: string, name: string): Value;
  /** A field of every row in `table` whose `relation` field points at this row (D36). */
  linked(table: string, relation: string, name: string): Value;
  /** The cells a place names in its Sheet view (D41): one value for `at`, a list for `range`. */
  place(p: Place): Value;
  /** Where a place is in its Sheet view's grid: its top row's position (from 1), its height, and the grid's size. */
  where(p: Place): { top: number; height: number; size: number } | FormulaError;
}

/** A row of a Sheet view: an offset from this row, a row id (pinned), or an open end (`nil`). */
export type PlaceRow = number | string | null;

/** Cells named by their place in a Sheet view (D41): what `at` and `range` read. */
export interface Place {
  /** The Sheet view's id. */
  view: string;
  /** Another table's name; absent for this row's table. */
  table?: string;
  from: { field: string; row: PlaceRow };
  to: { field: string; row: PlaceRow };
  /** An `at`: one cell, read as a value rather than a list. */
  single: boolean;
}

const AT_USAGE = 'at takes a field, a row and a Sheet view: (at "balance" -1 "by-date")';
const RANGE_USAGE = 'range takes two corners and a Sheet view: (range "c" nil "c" 0 "by-date")';

function placeRow(e: Expr | undefined, open: boolean): PlaceRow | undefined {
  if (e?.kind === "number" && Number.isInteger(e.value)) return e.value;
  if (e?.kind === "string" && e.value !== "") return e.value;
  if (open && e?.kind === "nil") return null;
  return undefined;
}

/**
 * The place an `at` or `range` form names, read from its arguments without
 * evaluating them: they are always written out (D41).
 */
export function placeOf(fn: string, args: Expr[]): Place | FormulaError {
  // Read once per formula, not once per row.
  let p = places.get(args);
  if (!p) places.set(args, (p = readPlace(fn, args)));
  return p;
}

const places = new WeakMap<Expr[], Place | FormulaError>();

function readPlace(fn: string, args: Expr[]): Place | FormulaError {
  const str = (e: Expr | undefined) => (e?.kind === "string" && e.value !== "" ? e.value : undefined);
  if (fn === "at") {
    const [f, r, v, t] = args;
    const field = str(f);
    const row = placeRow(r, false);
    const view = str(v);
    if (args.length < 3 || args.length > 4 || field === undefined || row === undefined || view === undefined || (t !== undefined && str(t) === undefined)) {
      return new FormulaError("#VALUE!", AT_USAGE);
    }
    const table = str(t);
    return { view, ...(table === undefined ? {} : { table }), from: { field, row }, to: { field, row }, single: true };
  }
  const [f1, r1, f2, r2, v, t] = args;
  const from = str(f1);
  const to = str(f2);
  const fromRow = placeRow(r1, true);
  const toRow = placeRow(r2, true);
  const view = str(v);
  if (
    args.length < 5 || args.length > 6 || from === undefined || to === undefined ||
    fromRow === undefined || toRow === undefined || view === undefined || (t !== undefined && str(t) === undefined)
  ) {
    return new FormulaError("#VALUE!", RANGE_USAGE);
  }
  const table = str(t);
  return {
    view,
    ...(table === undefined ? {} : { table }),
    from: { field: from, row: fromRow },
    to: { field: to, row: toRow },
    single: false,
  };
}

/** `row` and `rows` read where their argument is, never its value, so it must be written as an `at` or `range`. */
function placeArg(name: string, args: Expr[]): Place | FormulaError {
  const [a] = args;
  if (args.length !== 1 || a?.kind !== "call" || (a.fn !== "at" && a.fn !== "range")) {
    return new FormulaError("#VALUE!", `${name} takes an at or a range: (${name} (at "c" 0 "by-date"))`);
  }
  return placeOf(a.fn, a.args);
}

type Fn = (args: Expr[], scope: Scope) => Value;

/** Evaluate every argument; the first error among them is the result. */
function values(args: Expr[], scope: Scope): Value[] | FormulaError {
  const out: Value[] = [];
  for (const a of args) {
    const v = evaluate(a, scope);
    if (v instanceof FormulaError) return v;
    out.push(v);
  }
  return out;
}

function numeric(
  name: string,
  reduce: (vs: number[]) => Value,
  opts: { skipEmpty: boolean; arity?: [number, number] },
): Fn {
  return (args, scope) => {
    if (opts.arity && (args.length < opts.arity[0] || args.length > opts.arity[1])) {
      return new FormulaError("#VALUE!", `${name} takes ${opts.arity[0]}–${opts.arity[1]} arguments`);
    }
    const vs = values(args, scope);
    if (vs instanceof FormulaError) return vs;
    // sum / min / max / average take lists as spreadsheets take ranges:
    // every item counts, blanks skipped. Arithmetic on a list is an error.
    const flat: Value[] = [];
    for (const v of vs) {
      if (Array.isArray(v)) {
        if (!opts.skipEmpty) return new FormulaError("#VALUE!", `${name} needs single values, got a list`);
        for (const item of flatten(v)) {
          if (item instanceof FormulaError) return item;
          flat.push(item);
        }
      } else flat.push(v);
    }
    const nums: number[] = [];
    for (const v of flat) {
      if (isEmpty(v)) {
        if (opts.skipEmpty) continue;
        return undefined;
      }
      if (typeof v !== "number") return new FormulaError("#VALUE!", `${name} needs numbers, got ${JSON.stringify(v)}`);
      nums.push(v);
    }
    if (nums.length === 0) return undefined;
    const result = reduce(nums);
    // JSON has no Infinity or NaN; an overflow is an error, as in spreadsheets.
    if (typeof result === "number" && !Number.isFinite(result)) {
      return new FormulaError("#NUM!", `${name} gives a number too large to represent`);
    }
    return result;
  };
}

function compare(name: string, test: (c: number) => boolean): Fn {
  return (args, scope) => {
    if (args.length !== 2) return new FormulaError("#VALUE!", `${name} takes 2 arguments`);
    const vs = values(args, scope);
    if (vs instanceof FormulaError) return vs;
    const [a, b] = vs;
    if (name === "=" || name === "<>") {
      const same = (isEmpty(a) && isEmpty(b)) || a === b;
      return name === "=" ? same : !same;
    }
    if (isEmpty(a) || isEmpty(b)) return undefined;
    if (typeof a === "number" && typeof b === "number") return test(a - b);
    if (typeof a === "string" && typeof b === "string") return test(a < b ? -1 : a > b ? 1 : 0);
    return new FormulaError("#VALUE!", `${name} compares two numbers or two strings`);
  };
}

function text(name: string, f: (s: string) => Value): Fn {
  return (args, scope) => {
    if (args.length !== 1) return new FormulaError("#VALUE!", `${name} takes 1 argument`);
    const v = evaluate(args[0]!, scope);
    if (v instanceof FormulaError || isEmpty(v)) return v;
    return f(String(v));
  };
}

function logic(name: string, combine: (bs: boolean[]) => boolean): Fn {
  return (args, scope) => {
    const vs = values(args, scope);
    if (vs instanceof FormulaError) return vs;
    if (vs.some((v) => typeof v !== "boolean")) return new FormulaError("#VALUE!", `${name} needs true or false`);
    return combine(vs as boolean[]);
  };
}

/** Round half away from zero, as spreadsheets do (JS Math.round goes up). */
function roundHalfAway(x: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(Math.abs(x) * f + Number.EPSILON * f) / f;
  return x < 0 ? -r : r;
}

const FUNCTIONS: Record<string, Fn> = {
  "+": numeric("+", (n) => n.reduce((a, b) => a + b, 0), { skipEmpty: false }),
  "*": numeric("*", (n) => n.reduce((a, b) => a * b, 1), { skipEmpty: false }),
  "-": numeric("-", (n) => (n.length === 1 ? -n[0]! : n[0]! - n[1]!), { skipEmpty: false, arity: [1, 2] }),
  "/": numeric("/", (n) => (n[1] === 0 ? new FormulaError("#DIV/0!", "division by zero") : n[0]! / n[1]!), {
    skipEmpty: false,
    arity: [2, 2],
  }),
  sum: numeric("sum", (n) => n.reduce((a, b) => a + b, 0), { skipEmpty: true }),
  min: numeric("min", (n) => Math.min(...n), { skipEmpty: true }),
  max: numeric("max", (n) => Math.max(...n), { skipEmpty: true }),
  abs: numeric("abs", (n) => Math.abs(n[0]!), { skipEmpty: false, arity: [1, 1] }),
  round: numeric("round", (n) => roundHalfAway(n[0]!, n[1] ?? 0), { skipEmpty: false, arity: [1, 2] }),
  "=": compare("=", (c) => c === 0),
  "<>": compare("<>", (c) => c !== 0),
  "<": compare("<", (c) => c < 0),
  "<=": compare("<=", (c) => c <= 0),
  ">": compare(">", (c) => c > 0),
  ">=": compare(">=", (c) => c >= 0),
  and: logic("and", (b) => b.every(Boolean)),
  or: logic("or", (b) => b.some(Boolean)),
  not: (args, scope) => {
    if (args.length !== 1) return new FormulaError("#VALUE!", "not takes 1 argument");
    const v = evaluate(args[0]!, scope);
    if (v instanceof FormulaError) return v;
    return typeof v === "boolean" ? !v : new FormulaError("#VALUE!", "not needs true or false");
  },
  if: (args, scope) => {
    if (args.length < 2 || args.length > 3) return new FormulaError("#VALUE!", "if takes 2 or 3 arguments");
    const cond = evaluate(args[0]!, scope);
    if (cond instanceof FormulaError) return cond;
    if (isEmpty(cond)) return args[2] ? evaluate(args[2], scope) : undefined;
    if (typeof cond !== "boolean") return new FormulaError("#VALUE!", "if needs true or false");
    const branch = cond ? args[1] : args[2];
    return branch ? evaluate(branch, scope) : undefined;
  },
  isblank: (args, scope) => {
    if (args.length !== 1) return new FormulaError("#VALUE!", "isblank takes 1 argument");
    const v = evaluate(args[0]!, scope);
    return v instanceof FormulaError ? v : isEmpty(v);
  },
  concat: (args, scope) => {
    const vs = values(args, scope);
    if (vs instanceof FormulaError) return vs;
    return vs.map((v) => (isEmpty(v) ? "" : String(v))).join("");
  },
  average: numeric("average", (n) => n.reduce((a, b) => a + b, 0) / n.length, { skipEmpty: true }),
  // How many values are there: blanks aren't counted, a list counts its items.
  count: (args, scope) => {
    const vs = values(args, scope);
    if (vs instanceof FormulaError) return vs;
    let n = 0;
    for (const v of flatten(vs)) {
      if (v instanceof FormulaError) return v;
      if (!isEmpty(v)) n += 1;
    }
    return n;
  },
  // Reading across rows (D36). Each names what it reads; nothing is stored.
  column: (args, scope) => {
    const [a] = args;
    if (args.length !== 1 || a?.kind !== "string") return new FormulaError("#VALUE!", 'column takes a field name: (column "quarter")');
    return scope.column(a.value);
  },
  lookup: (args, scope) => {
    const [a, b] = args;
    if (args.length !== 2 || a?.kind !== "string" || b?.kind !== "string") {
      return new FormulaError("#VALUE!", 'lookup takes a relation field and a field there: (lookup "company" "industry")');
    }
    return scope.lookup(a.value, b.value);
  },
  linked: (args, scope) => {
    const [t, r, f] = args;
    if (args.length !== 3 || t?.kind !== "string" || r?.kind !== "string" || f?.kind !== "string") {
      return new FormulaError("#VALUE!", 'linked takes a table, its relation field and a field: (linked "deals" "company" "value")');
    }
    return scope.linked(t.value, r.value, f.value);
  },
  // Reading by place in a Sheet view (D41).
  at: (args, scope) => {
    const p = placeOf("at", args);
    return p instanceof FormulaError ? p : scope.place(p);
  },
  range: (args, scope) => {
    const p = placeOf("range", args);
    return p instanceof FormulaError ? p : scope.place(p);
  },
  row: (args, scope) => {
    const p = placeArg("row", args);
    const w = p instanceof FormulaError ? p : scope.where(p);
    if (w instanceof FormulaError) return w;
    return w.height > 0 && w.top >= 1 && w.top <= w.size ? w.top : new FormulaError("#REF!", "that row is off the grid");
  },
  rows: (args, scope) => {
    const p = placeArg("rows", args);
    const w = p instanceof FormulaError ? p : scope.where(p);
    return w instanceof FormulaError ? w : w.height;
  },
  upper: text("upper", (s) => s.toUpperCase()),
  lower: text("lower", (s) => s.toLowerCase()),
  len: text("len", (s) => Array.from(s).length),
  // (field "name") is this row's field; (field "name" "<row id>") is that
  // row's (D34), which is how a typed coordinate like =B7 is stored.
  field: (args, scope) => {
    const [a, b] = args;
    if (args.length < 1 || args.length > 2 || a?.kind !== "string" || (b !== undefined && b.kind !== "string")) {
      return new FormulaError("#VALUE!", 'field takes a name and, optionally, a row id: (field "unit price" "r7")');
    }
    return b === undefined ? scope.field(a.value) : scope.fieldOf(b.value, a.value);
  },
};

/**
 * The standard library's function names (D32), lowercase — what an
 * authoring surface may compile a function call to. Anything else is
 * refused at entry (D29 addendum).
 */
export const FUNCTION_NAMES: readonly string[] = Object.freeze(Object.keys(FUNCTIONS));

export function evaluate(expr: Expr, scope: Scope): Value {
  switch (expr.kind) {
    case "number":
    case "string":
    case "boolean":
      return expr.value;
    case "nil":
      return undefined;
    case "field":
      return scope.field(expr.name);
    case "call": {
      const fn = FUNCTIONS[expr.fn];
      if (!fn) return new FormulaError("#NAME?", `unknown function ${expr.fn}`);
      return fn(expr.args, scope);
    }
  }
}
