// Reads OpenFormula's formula text (ODF 1.4 Part 4, section 5) into a
// Node, for the importer. Written to the spec's grammar, not borrowed
// from an engine: the suite measures engines, so it can't share one's
// reading of the text.
//
// Covers numbers, strings, inline arrays, function calls, the operators
// of section 5.5, omitted arguments, and references to a cell or a
// rectangle of cells on the case's own sheet. Those are read as
// `(ref "A1")` or `(ref "A1:B3")`: suite scaffolding, with the cells'
// values carried in the case (edn.ts), not part of the stored form. A
// reference to another sheet, a whole row or column, an error literal
// or a named expression is refused, so the importer can count what it
// leaves for later.

import type { Node } from "./node.js";

export class Unsupported extends Error {}

// Section 5.5, Table 1, lowest to highest. `^` is POWER by definition
// (6.4.6), and `^` isn't a legal EDN symbol, so it's stored as `power`.
const INFIX: { ops: string[]; to?: Record<string, string> }[] = [
  { ops: ["=", "<>", "<=", ">=", "<", ">"] },
  { ops: ["&"] },
  { ops: ["+", "-"] },
  { ops: ["*", "/"] },
  { ops: ["^"], to: { "^": "power" } },
];

const NUMBER = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9._]*/;

const CELL = /^\$?([A-Z]+)\$?([0-9]+)$/;

/**
 * `.A1`, `.$A$1`, `.A1:.B3` or `Sheet2.A1:.B3` on the case's own sheet,
 * as `A1` or `A1:B3`. Anything else is refused.
 */
function sameSheetRange(inside: string, sheet: string): string {
  const parts = inside.split(":");
  if (parts.length > 2) throw new Unsupported("a reference to another sheet");
  const cells = parts.map((p) => {
    const dot = p.lastIndexOf(".");
    if (dot < 0) throw new Unsupported("a reference to another sheet");
    const name = p.slice(0, dot).replace(/^\$/, "").replace(/^'(.*)'$/, "$1");
    if (name !== "" && name !== sheet) throw new Unsupported("a reference to another sheet");
    const m = CELL.exec(p.slice(dot + 1));
    if (!m) throw new Unsupported("a whole row or column");
    return `${m[1]}${m[2]}`;
  });
  return cells.join(":");
}

/**
 * `of:=ROUND(2.348;2)`, `=ROUND(2.348;2)` or `ROUND(2.348;2)`. `sheet`
 * is the name of the sheet the formula sits on, so a reference that
 * names it counts as its own.
 */
export function readOpenFormula(text: string, sheet = "Sheet2"): Node {
  let src = text.startsWith("of:") ? text.slice(3) : text;
  if (src.startsWith("=")) src = src.slice(1);
  let pos = 0;

  const skip = () => {
    while (pos < src.length && (src[pos] === " " || src[pos] === "\t" || src[pos] === "\n")) pos++;
  };
  const peek = (s: string) => {
    skip();
    return src.startsWith(s, pos);
  };
  const eat = (s: string) => {
    if (!peek(s)) throw new SyntaxError(`expected ${s} at ${pos} in ${text}`);
    pos += s.length;
  };

  const infix = (level: number): Node => {
    if (level === INFIX.length) return postfix();
    let left = infix(level + 1);
    for (;;) {
      skip();
      const op = INFIX[level]!.ops.find((o) => src.startsWith(o, pos));
      if (!op) return left;
      // `<` must not swallow `<=` or `<>`: the list puts longer ones first.
      pos += op.length;
      const right = infix(level + 1);
      left = { kind: "call", fn: INFIX[level]!.to?.[op] ?? op, args: [left, right] };
    }
  };

  // Table 1: prefix + and - bind tightest, then postfix %, then ^.
  // So -2^2 is 4, and -2% is (-2)%.
  const postfix = (): Node => {
    let node = prefix();
    while (peek("%")) {
      pos++;
      node = { kind: "call", fn: "%", args: [node] };
    }
    return node;
  };

  const prefix = (): Node => {
    skip();
    const c = src[pos];
    if (c === "-" || c === "+") {
      pos++;
      return { kind: "call", fn: c, args: [prefix()] };
    }
    return primary();
  };

  const args = (close: string, sep: string): Node[] => {
    const out: Node[] = [];
    if (peek(close)) return out;
    for (;;) {
      skip();
      // An omitted argument: nothing between separators or before the close.
      if (peek(sep) || peek(close)) out.push({ kind: "omitted" });
      else out.push(infix(0));
      if (peek(sep)) {
        pos++;
        continue;
      }
      return out;
    }
  };

  const primary = (): Node => {
    skip();
    const c = src[pos];
    if (c === undefined) throw new SyntaxError(`unexpected end of ${text}`);
    if (c === "(") {
      pos++;
      const inner = infix(0);
      eat(")");
      return inner;
    }
    if (c === '"') {
      let value = "";
      pos++;
      for (;;) {
        const q = src.indexOf('"', pos);
        if (q < 0) throw new SyntaxError(`unterminated string in ${text}`);
        value += src.slice(pos, q);
        pos = q + 1;
        if (src[pos] === '"') {
          value += '"';
          pos++;
        } else break;
      }
      return { kind: "string", value };
    }
    if (c === "{") {
      pos++;
      const rows: Node[][] = [];
      for (;;) {
        const row: Node[] = [];
        for (;;) {
          row.push(infix(0));
          if (peek(";")) {
            pos++;
            continue;
          }
          break;
        }
        rows.push(row);
        if (peek("|")) {
          pos++;
          continue;
        }
        break;
      }
      eat("}");
      return { kind: "array", rows };
    }
    if (c === "[") {
      const close = src.indexOf("]", pos);
      if (close < 0) throw new SyntaxError(`unterminated reference in ${text}`);
      const ref = sameSheetRange(src.slice(pos + 1, close), sheet);
      pos = close + 1;
      return { kind: "call", fn: "ref", args: [{ kind: "string", value: ref }] };
    }
    if (c === "#") throw new Unsupported("an error literal");
    const num = NUMBER.exec(src.slice(pos));
    if (num) {
      pos += num[0].length;
      return { kind: "number", value: Number(num[0]) };
    }
    const name = NAME.exec(src.slice(pos));
    if (name) {
      pos += name[0].length;
      if (peek("(")) {
        pos++;
        const a = args(")", ";");
        eat(")");
        const fn = name[0].toLowerCase();
        // TRUE() and FALSE() are the logical constants (6.15.9, 6.15.4).
        // EDN's `true` and `false` are literals, so `(true)` can't be a call.
        if ((fn === "true" || fn === "false") && a.length === 0) return { kind: "boolean", value: fn === "true" };
        return { kind: "call", fn, args: a };
      }
      const upper = name[0].toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
      throw new Unsupported("a named expression");
    }
    throw new SyntaxError(`unexpected ${c} at ${pos} in ${text}`);
  };

  const node = infix(0);
  skip();
  if (pos !== src.length) throw new SyntaxError(`unexpected ${src[pos]} at ${pos} in ${text}`);
  return node;
}
