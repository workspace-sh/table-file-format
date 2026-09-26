/**
 * The Excel-style authoring surface for computed fields (DECISIONS D29).
 *
 * A formula is stored in one notation only: `table-expr-v1`, the
 * S-expression form every reader evaluates. People type — and are shown —
 * Excel-style syntax instead. This module is the two directions between
 * them:
 *
 *   compileFormula("=ROUND(budget / 12, 0)")  → (round (/ budget 12) 0)
 *   printFormula("(round (/ budget 12) 0)")   → =round(budget / 12, 0)
 *
 * What it accepts, and what it refuses, follows PRIOR-ART's "Authoring
 * syntaxes" notes: field references as a bare word, `[@x]`, `{x}`,
 * `prop("x")` or `$x`; `==` and `!=` for `=` and `<>`; function names in
 * any case (D29 stores them lowercase); anything outside D32's library,
 * or a cell address like `B7`, refused at entry and never stored.
 *
 * Nothing here evaluates. It is pure text-to-tree-to-text, so it runs
 * wherever table-core does and any app's formula bar can share it.
 */

import { FUNCTION_NAMES, parseExpr, type Expr } from "./expr.js";
import type { FieldType } from "./types.js";

export type CompileResult =
  | {
      ok: true;
      expr: Expr;
      /** The canonical `table-expr-v1` text — what `computed.expr` holds. */
      stored: string;
      /** Compiles, but will likely show an error value (e.g. a field that doesn't exist). */
      warnings: string[];
    }
  | { ok: false; message: string; at: number };

// ---- stored form

/** A field name the stored grammar can write as a bare word (SPEC section 2). */
function isBareWord(name: string): boolean {
  return (
    /^[^\s()"]+$/.test(name) &&
    name !== "true" &&
    name !== "false" &&
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(name)
  );
}

/** A reference to field `name`: a bare word when it can be one, else `(field "…")`. */
function fieldRef(name: string): Expr {
  return isBareWord(name)
    ? { kind: "field", name }
    : { kind: "call", fn: "field", args: [{ kind: "string", value: name }] };
}

/** The canonical `table-expr-v1` text for a tree. */
export function formatExpr(expr: Expr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "string":
      return JSON.stringify(expr.value);
    case "boolean":
      return expr.value ? "true" : "false";
    case "field":
      return isBareWord(expr.name) ? expr.name : `(field ${JSON.stringify(expr.name)})`;
    case "call":
      return expr.args.length === 0
        ? `(${expr.fn})`
        : `(${expr.fn} ${expr.args.map(formatExpr).join(" ")})`;
  }
}

// ---- Excel-style → stored

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "ref"; v: string; at: number } // a field reference in explicit syntax
  | { t: "ident"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "end"; at: number };

class CompileError {
  constructor(
    readonly message: string,
    readonly at: number,
  ) {}
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u;
const OPS = ["<=", ">=", "<>", "!=", "==", "=", "<", ">", "+", "-", "*", "/", "&", "(", ")", ","];

function tokenize(src: string, offset: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  const at = () => offset + i;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: at() });
      i += num[0].length;
      continue;
    }
    if (c === '"') {
      // Excel's string rule: "" is a literal quote; nothing else escapes.
      const start = at();
      let v = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new CompileError("This text is missing its closing quote.", start);
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += src[i];
        i++;
      }
      out.push({ t: "str", v, at: start });
      continue;
    }
    if (c === "{" || c === "[") {
      // {name} (Airtable) or [@name] / [name] (Excel tables).
      const close = c === "{" ? "}" : "]";
      const end = src.indexOf(close, i + 1);
      if (end === -1) throw new CompileError(`This field reference is missing its closing ${close}.`, at());
      let name = src.slice(i + 1, end);
      if (c === "[" && name.startsWith("@")) name = name.slice(1);
      if (name.trim() === "") throw new CompileError("A field reference needs a field name inside it.", at());
      out.push({ t: "ref", v: name, at: at() });
      i = end + 1;
      continue;
    }
    if (c === "$") {
      // $name (Grist).
      const id = IDENT.exec(src.slice(i + 1));
      if (!id) throw new CompileError("$ needs a field name after it.", at());
      out.push({ t: "ref", v: id[0], at: at() });
      i += 1 + id[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      out.push({ t: "ident", v: id[0], at: at() });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ t: "op", v: op, at: at() });
      i += op.length;
      continue;
    }
    throw new CompileError(`“${c}” isn't something a formula can use here.`, at());
  }
  out.push({ t: "end", at: offset + src.length });
  return out;
}

/** Binary operators, loosest first. `&` is Excel's text join. */
const BINARY: Record<string, { prec: number; fn: string; flat: boolean }> = {
  "=": { prec: 1, fn: "=", flat: false },
  "==": { prec: 1, fn: "=", flat: false },
  "<>": { prec: 1, fn: "<>", flat: false },
  "!=": { prec: 1, fn: "<>", flat: false },
  "<": { prec: 1, fn: "<", flat: false },
  "<=": { prec: 1, fn: "<=", flat: false },
  ">": { prec: 1, fn: ">", flat: false },
  ">=": { prec: 1, fn: ">=", flat: false },
  "&": { prec: 2, fn: "concat", flat: true },
  "+": { prec: 3, fn: "+", flat: true },
  "-": { prec: 3, fn: "-", flat: false },
  "*": { prec: 4, fn: "*", flat: true },
  "/": { prec: 4, fn: "/", flat: false },
};

const CALLABLE = new Set(FUNCTION_NAMES.filter((n) => /^[a-z]/.test(n)));
const CELL_ADDRESS = /^[A-Za-z]{1,3}[0-9]+$/;

/**
 * Compile Excel-style formula text to `table-expr-v1`. A leading `=` is
 * optional. `fields` — the table's field names — lets a reference to a
 * field that doesn't exist come back as a warning, and lets a field
 * named like a cell address (`B7`) be used by name.
 */
export function compileFormula(text: string, options: { fields?: Iterable<string> } = {}): CompileResult {
  const fields = options.fields ? new Set(options.fields) : undefined;
  const lead = /^\s*=?/.exec(text)![0].length;
  const body = text.slice(lead);
  if (body.trim() === "") return { ok: false, message: "Type a formula, such as =round(budget / 12, 0).", at: lead };

  // The stored form, typed directly (#76; D29 allows it at the authoring
  // layer). Tried only for text that opens with "(", and taken only when
  // it reads completely and uses D32's functions, so an Excel-style
  // "(budget + 1) * 2" still compiles as Excel.
  if (body.trimStart().startsWith("(")) {
    const stored = compileStoredForm(body, lead, fields);
    if (stored.ok) return stored;
    const excel = compileExcel(body, lead, fields);
    // Neither: the stored form's reason when it read as one, so a typo in
    // a function name isn't reported as an Excel syntax error.
    return excel.ok || !stored.parsed ? excel : stored.failure;
  }
  return compileExcel(body, lead, fields);
}

/** Library functions, as the stored form names them (D32). */
const LIBRARY = new Set(FUNCTION_NAMES);

function compileStoredForm(
  body: string,
  lead: number,
  fields: Set<string> | undefined,
): (CompileResult & { ok: true }) | { ok: false; parsed: boolean; failure: CompileResult & { ok: false } } {
  const read = parseExpr(body);
  if (!read.ok) {
    return { ok: false, parsed: false, failure: { ok: false, message: read.message, at: lead + read.at } };
  }
  const warnings = new Set<string>();
  let unknown: string | null = null;
  // The reader has already lowercased function names, as D32 writes them.
  const walk = (e: Expr): Expr => {
    if (e.kind === "field") {
      if (fields && !fields.has(e.name)) warnings.add(`There is no field called “${e.name}”, so the result will show #NAME?.`);
      return e;
    }
    if (e.kind !== "call") return e;
    const fn = e.fn;
    if (fn === "field") {
      const [a, b] = e.args;
      if (e.args.length === 1 && a?.kind === "string") {
        if (fields && !fields.has(a.value)) warnings.add(`There is no field called “${a.value}”, so the result will show #NAME?.`);
        return fieldRef(a.value);
      }
      // Another row's field (D34): kept as written.
      if (e.args.length === 2 && a?.kind === "string" && b?.kind === "string") {
        if (fields && !fields.has(a.value)) warnings.add(`There is no field called “${a.value}”, so the result will show #NAME?.`);
        return e;
      }
    }
    if (!LIBRARY.has(fn)) unknown ??= fn;
    return { kind: "call", fn, args: e.args.map(walk) };
  };
  const expr = walk(read.expr);
  if (unknown !== null) {
    const names = [...LIBRARY].filter((n) => /^[a-z]/.test(n) && n !== "field").join(", ");
    return {
      ok: false,
      parsed: true,
      failure: { ok: false, message: `${unknown} isn't a function .table formulas have. They can use: ${names}.`, at: lead },
    };
  }
  const stored = formatExpr(expr);
  const back = parseExpr(stored);
  if (!back.ok || formatExpr(back.expr) !== stored) {
    return { ok: false, parsed: true, failure: { ok: false, message: "This formula can't be stored faithfully.", at: lead } };
  }
  return { ok: true, expr, stored, warnings: [...warnings] };
}

function compileExcel(body: string, lead: number, fields: Set<string> | undefined): CompileResult {
  const warnings = new Set<string>();

  let tokens: Token[];
  try {
    tokens = tokenize(body, lead);
  } catch (e) {
    const err = e as CompileError;
    return { ok: false, message: err.message, at: err.at };
  }
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === "op" && t.v === v;
  };
  const expectOp = (v: string, what: string) => {
    if (!isOp(v)) throw new CompileError(what, peek().at);
    next();
  };

  const ref = (name: string): Expr => {
    if (fields && !fields.has(name)) warnings.add(`There is no field called “${name}”, so the result will show #NAME?.`);
    return fieldRef(name);
  };

  const call = (name: string, at: number): Expr => {
    const fn = name.toLowerCase();
    const args: Expr[] = [];
    if (!isOp(")")) {
      for (;;) {
        args.push(parse(0));
        if (isOp(",")) {
          next();
          continue;
        }
        break;
      }
    }
    expectOp(")", `${name}( is missing its closing ).`);
    // prop("x") and field("x") are field references, not functions.
    // field("x", "r7") is field x of the row whose id is r7 (D34).
    if (fn === "field" && args.length === 2) {
      const [a, b] = args;
      if (a?.kind !== "string" || b?.kind !== "string") {
        throw new CompileError(`${name}(…) takes a field name and a row id, both in quotes, as in ${name}("budget", "r7").`, at);
      }
      ref(a.value);
      return { kind: "call", fn: "field", args: [a, b] };
    }
    if (fn === "prop" || fn === "field") {
      const [a] = args;
      if (args.length !== 1 || a?.kind !== "string") {
        throw new CompileError(`${name}(…) takes one field name in quotes, as in ${name}("unit price").`, at);
      }
      return ref(a.value);
    }
    if (!CALLABLE.has(fn)) {
      throw new CompileError(
        `${name} isn't a function .table formulas have. They can use: ${[...CALLABLE]
          .filter((n) => n !== "field")
          .join(", ")}.`,
        at,
      );
    }
    return { kind: "call", fn, args };
  };

  const primary = (): Expr => {
    const t = next();
    switch (t.t) {
      case "num":
        return { kind: "number", value: t.v };
      case "str":
        return { kind: "string", value: t.v };
      case "ref":
        return ref(t.v);
      case "ident": {
        if (isOp("(")) {
          next();
          return call(t.v, t.at);
        }
        const lower = t.v.toLowerCase();
        if (lower === "true" || lower === "false") return { kind: "boolean", value: lower === "true" };
        if (CELL_ADDRESS.test(t.v) && !(fields?.has(t.v) ?? false)) {
          throw new CompileError(
            `${t.v} looks like a cell address. A formula here works on every row, so refer to a field by its name instead.`,
            t.at,
          );
        }
        return ref(t.v);
      }
      case "op":
        if (t.v === "(") {
          const inner = parse(0);
          expectOp(")", "A ( is missing its closing ).");
          return inner;
        }
        if (t.v === "-") {
          // A minus written straight onto a number is that negative number,
          // as the stored form writes it: -2.5, not (- 2.5).
          const n = peek();
          if (n.t === "num") {
            next();
            return { kind: "number", value: -n.v };
          }
          return { kind: "call", fn: "-", args: [parse(5)] };
        }
        if (t.v === "+") return parse(5);
        throw new CompileError(`A formula can't start with “${t.v}” here.`, t.at);
      case "end":
        throw new CompileError("The formula ends too soon.", t.at);
    }
  };

  const parse = (minPrec: number): Expr => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t.t !== "op") break;
      const op = BINARY[t.v];
      if (!op || op.prec <= minPrec) break;
      next();
      // Comparisons don't chain: a = b = c is refused rather than guessed at.
      if (op.prec === 1 && left.kind === "call" && ["=", "<>", "<", "<=", ">", ">="].includes(left.fn) && (left as { chained?: boolean }).chained) {
        throw new CompileError("Comparisons can't be chained. Use and(…) to combine them.", t.at);
      }
      const right = parse(op.prec);
      if (op.flat && left.kind === "call" && left.fn === op.fn && (left as { flat?: boolean }).flat) {
        left.args.push(right);
      } else {
        const node = { kind: "call", fn: op.fn, args: [left, right] } as Expr & { flat?: boolean; chained?: boolean };
        if (op.flat) node.flat = true;
        if (op.prec === 1) node.chained = true;
        left = node;
      }
    }
    return left;
  };

  let expr: Expr;
  try {
    expr = parse(0);
    const t = peek();
    if (t.t !== "end") {
      throw new CompileError(
        t.t === "op" && t.v === ")" ? "There's a ) with no ( to match it." : "Something after this doesn't belong to the formula.",
        t.at,
      );
    }
  } catch (e) {
    const err = e as CompileError;
    return { ok: false, message: err.message, at: err.at };
  }

  const clean = strip(expr);
  const stored = formatExpr(clean);
  // The stored text must read back as exactly this tree. If it doesn't,
  // refusing is safer than writing something a reader would take apart
  // differently.
  const back = parseExpr(stored);
  if (!back.ok || formatExpr(back.expr) !== stored) {
    return { ok: false, message: "This formula can't be stored faithfully.", at: lead };
  }
  return { ok: true, expr: clean, stored, warnings: [...warnings] };
}

/** Drop the parser's bookkeeping marks, leaving a plain `Expr`. */
function strip(e: Expr): Expr {
  if (e.kind !== "call") return e;
  return { kind: "call", fn: e.fn, args: e.args.map(strip) };
}

// ---- stored → Excel-style

const PRINT_PREC: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  "<=": 1,
  ">": 1,
  ">=": 1,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
};

function precOf(e: Expr): number {
  if (e.kind === "call") {
    if (e.fn === "-" && e.args.length === 1) return 5;
    const p = PRINT_PREC[e.fn];
    if (p !== undefined && e.args.length >= 2) return p;
  }
  if (e.kind === "number" && e.value < 0) return 5;
  return 6;
}

/** A field reference as a person would type it. */
function printRef(name: string): string {
  if (
    IDENT.exec(name)?.[0] === name &&
    !/^(true|false)$/i.test(name) &&
    !CELL_ADDRESS.test(name)
  ) {
    return name;
  }
  return name.includes("}") ? `prop(${printString(name)})` : `{${name}}`;
}

function printString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function printExpr(e: Expr): string {
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "string":
      return printString(e.value);
    case "boolean":
      return e.value ? "true" : "false";
    case "field":
      return printRef(e.name);
    case "call": {
      if (e.fn === "field" && e.args.length === 1 && e.args[0]!.kind === "string") {
        return printRef(e.args[0]!.value);
      }
      if (e.fn === "-" && e.args.length === 1) {
        const a = e.args[0]!;
        // -(2) keeps a negated literal distinct from the literal -2.
        return precOf(a) < 5 || a.kind === "number" ? `-(${printExpr(a)})` : `-${printExpr(a)}`;
      }
      const p = PRINT_PREC[e.fn];
      if (p !== undefined && e.args.length >= 2 && (e.args.length === 2 || e.fn === "+" || e.fn === "*")) {
        const nonAssoc = e.fn === "-" || e.fn === "/" || p === 1;
        return e.args
          .map((a, i) => {
            const ap = precOf(a);
            const wrap = ap < p || (ap === p && (p === 1 || (nonAssoc && i > 0)));
            return wrap ? `(${printExpr(a)})` : printExpr(a);
          })
          .join(` ${e.fn} `);
      }
      return `${e.fn}(${e.args.map(printExpr).join(", ")})`;
    }
  }
}

/**
 * Show a stored formula the way people write one: `=round(budget / 12, 0)`.
 * Function names are shown lowercase, as they are stored: typing is
 * case-insensitive, so `=ROUND(…)` works the same, and which case to show
 * is an app's choice (D29 keeps no rendering in the file).
 * Accepts the stored text or a tree. Stored text that doesn't parse comes
 * back as-is, so an editor can still show what's there.
 */
export function printFormula(stored: string | Expr): string {
  if (typeof stored === "string") {
    const r = parseExpr(stored);
    if (!r.ok) return stored;
    return `=${printExpr(r.expr)}`;
  }
  return `=${printExpr(stored)}`;
}

// ---- what a new formula field's values will be

const NUMBER_FNS = new Set(["+", "-", "*", "/", "sum", "min", "max", "round", "abs", "len"]);
const TEXT_FNS = new Set(["concat", "upper", "lower"]);
const BOOLEAN_FNS = new Set(["=", "<>", "<", "<=", ">", ">=", "and", "or", "not", "isblank"]);

/**
 * The field type a formula produces, for declaring a new computed field.
 * `fieldTypes` resolves references to other fields; anything unknown is
 * taken as a number, which is what most formulas make.
 */
export function formulaType(expr: Expr, fieldTypes: Map<string, FieldType> = new Map()): FieldType {
  switch (expr.kind) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "field":
      return fieldTypes.get(expr.name) ?? "number";
    case "call":
      if (TEXT_FNS.has(expr.fn)) return "string";
      if (BOOLEAN_FNS.has(expr.fn)) return "boolean";
      if (NUMBER_FNS.has(expr.fn)) return "number";
      if (expr.fn === "field" && expr.args[0]?.kind === "string") {
        return fieldTypes.get(expr.args[0].value) ?? "number";
      }
      if (expr.fn === "if" && expr.args[1]) return formulaType(expr.args[1], fieldTypes);
      return "number";
  }
}

/** One cell a formula reads: a field of this row, or of another row by its id (D34). */
export interface FormulaRef {
  field: string;
  /** Absent: the row being computed. */
  rowId?: string;
}

/**
 * The cells a formula reads, in the order they first appear: what a UI
 * highlights as "this result comes from these cells".
 */
export function formulaRefs(expr: Expr): FormulaRef[] {
  const seen: FormulaRef[] = [];
  const add = (ref: FormulaRef) => {
    if (!seen.some((r) => r.field === ref.field && r.rowId === ref.rowId)) seen.push(ref);
  };
  const walk = (e: Expr): void => {
    if (e.kind === "field") add({ field: e.name });
    else if (e.kind === "call") {
      const [a, b] = e.args;
      if (e.fn === "field" && a?.kind === "string" && e.args.length === 1) add({ field: a.value });
      else if (e.fn === "field" && a?.kind === "string" && b?.kind === "string" && e.args.length === 2) {
        add({ field: a.value, rowId: b.value });
      } else e.args.forEach(walk);
    }
  };
  walk(expr);
  return seen;
}

/** The fields a formula reads, in this row or another, each once. */
export function formulaFields(expr: Expr): string[] {
  const names: string[] = [];
  for (const r of formulaRefs(expr)) if (!names.includes(r.field)) names.push(r.field);
  return names;
}
