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

/**
 * A bare word, as SPEC section 2 defines it: what EDN calls a symbol. It
 * starts with a letter or one of `* + ! - _ ? < > = & %` (not `+` or `-`
 * before a digit) and goes on with letters, digits, those, `.` and `/`;
 * `/` alone is division. EDN's other forms (`:keyword`, `#tag`, `{map}`)
 * aren't words, and a formula with one can't be read.
 */
const SYMBOL = /^(?:\/|(?:[\p{L}*!_?<>=&%]|[+-](?!\d))[\p{L}\p{N}*+!\-_?<>=&%./]*)$/u;

export function isSymbol(word: string): boolean {
  return SYMBOL.test(word);
}

/** Read a stored `expr`. Anything but one complete expression is refused. */
/**
 * Names a form had before (D48), read as the name it has now: a stored
 * formula written with one is the same formula, and is stored under the
 * new name when it is next saved.
 */
export const FORMER_NAMES: Readonly<Record<string, string>> = Object.freeze({ column: "values", lookup: "related", concat: "concatenate" });

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
      if (!isSymbol(head![0])) fail(`${head![0]} isn't a function's name`);
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
      const lower = head![0].toLowerCase();
      return { kind: "call", fn: FORMER_NAMES[lower] ?? lower, args };
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
    if (!isSymbol(word[0])) fail(`${word[0]} isn't a field's name: write (field ${JSON.stringify(word[0])})`);
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

// ---- what formulas give, and the places they read
//
// Formulas are worked out by the EDN core (edn/, set with setFormulaEngine):
// there is no evaluator here. What stays is what reads a formula without
// working it out: the values it gives, and the Sheet places it names.

type Scalar = number | string | boolean | undefined | FormulaError;
/** A list comes from reading across rows: `column`, `linked`, or a many `lookup` (D36). */
export type Value = Scalar | Value[];

export const isEmpty = (v: unknown): v is undefined => v === undefined || v === null || v === "";

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

/**
 * The standard library's function names (D32), lowercase — what an
 * authoring surface may compile a function call to. Anything else is
 * refused at entry (D29 addendum). The EDN core works out exactly these.
 */
export const FUNCTION_NAMES: readonly string[] = Object.freeze([
  "today", "now", "rand", "+", "*", "-", "/", "sum", "min", "max", "abs", "round", "=", "<>", "<", "<=", ">", ">=",
  "and", "or", "not", "if", "isblank", "concatenate", "average", "count", "values", "related", "linked",
  "at", "range", "row", "rows", "upper", "lower", "len", "field",
]);
