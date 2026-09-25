/**
 * table-expr-v1 — the computed-field dialect (DECISIONS D29, SPEC
 * section 2 "Computed fields"). A reader and a row-local evaluator.
 *
 * Grammar: `(function arg …)`; numbers and strings as in JSON; `true`,
 * `false`; a bare word is a field of the same row, and
 * `(field "any name")` reaches one whose name isn't a bare word.
 * Function names are read case-insensitively; field names are not.
 *
 * Values follow the spreadsheet conventions people already know: an
 * empty operand makes arithmetic empty, while `sum` / `min` / `max`
 * skip empties; failures are error values that show a spreadsheet code
 * (`#DIV/0!`) and pass through whatever uses them. Pure TypeScript,
 * no platform APIs — it runs wherever table-core does.
 */

import type { Field, Row, TableSchema, ValidationError } from "./types.js";

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

type Value = number | string | boolean | undefined | FormulaError;

const isEmpty = (v: unknown): v is undefined => v === undefined || v === null || v === "";

interface Scope {
  field(name: string): Value;
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
    const nums: number[] = [];
    for (const v of vs) {
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
  upper: text("upper", (s) => s.toUpperCase()),
  lower: text("lower", (s) => s.toLowerCase()),
  len: text("len", (s) => Array.from(s).length),
  field: (args, scope) => {
    const a = args[0];
    if (args.length !== 1 || a?.kind !== "string") {
      return new FormulaError("#VALUE!", 'field takes one name, as in (field "unit price")');
    }
    return scope.field(a.value);
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
    case "field":
      return scope.field(expr.name);
    case "call": {
      const fn = FUNCTIONS[expr.fn];
      if (!fn) return new FormulaError("#NAME?", `unknown function ${expr.fn}`);
      return fn(expr.args, scope);
    }
  }
}

// ---- computing a table's rows

/**
 * Rows with their computed fields filled in, for display and querying.
 * Results are never stored (SPEC section 2): callers hand these to views,
 * not to a writer — and the writer drops computed fields regardless.
 * An `expr` that doesn't parse leaves its field empty and is reported
 * once. A table with no computed fields returns the same array.
 */
export function computeRows(
  schema: TableSchema,
  rows: Row[],
): { rows: Row[]; diagnostics: ValidationError[] } {
  const computed = schema.fields.filter((f) => f.computed);
  if (computed.length === 0) return { rows, diagnostics: [] };

  const diagnostics: ValidationError[] = [];
  const known = new Map<string, Field>(schema.fields.map((f) => [f.name, f]));
  const parsed = new Map<string, Expr | null>();
  for (const f of computed) {
    const { expr, dialect } = f.computed!;
    if (dialect !== "table-expr-v1") {
      diagnostics.push({ rowIndex: -1, field: f.name, message: `unknown formula dialect ${dialect}` });
      parsed.set(f.name, null);
      continue;
    }
    const r = parseExpr(expr);
    if (!r.ok) {
      diagnostics.push({
        rowIndex: -1,
        field: f.name,
        message: `formula doesn't parse (${r.message} at ${r.at}): ${expr}`,
      });
      parsed.set(f.name, null);
    } else {
      parsed.set(f.name, r.expr);
    }
  }

  const out = rows.map((row) => {
    const results = new Map<string, Value>();
    const inProgress = new Set<string>();
    const scope: Scope = {
      field(name) {
        const def = known.get(name);
        if (!def) return new FormulaError("#NAME?", `no field named ${name}`);
        if (!def.computed) return row[name] as Value;
        if (results.has(name)) return results.get(name);
        if (inProgress.has(name)) return new FormulaError("#REF!", `${name} depends on itself`);
        const expr = parsed.get(name);
        if (!expr) return undefined;
        inProgress.add(name);
        const v = evaluate(expr, scope);
        inProgress.delete(name);
        results.set(name, v);
        return v;
      },
    };
    const next: Row = { ...row };
    for (const f of computed) {
      const v = scope.field(f.name);
      if (v === undefined) delete next[f.name];
      else next[f.name] = v;
    }
    return next;
  });
  return { rows: out, diagnostics };
}
