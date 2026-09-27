// The suite's files are EDN: one case per line,
//   {:expr (round 2.348 2) :expect 2.35 :from "Sheet2!A2"}
// `:expr` is the stored form of SPEC section 2. `:expect` is a number,
// string or boolean, `[[…]]` for an array, `{:error "#N/A"}`, or
// `{:error nil}` for any error. `:round 12` or `:sig 10` compares
// numbers rounded, as the source's own check did.

import { parseEDNString } from "edn-data";
import type { Compare, Node, Value } from "./node.js";

// ---- printing

function ednString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

/** EDN has no NaN or infinity; neither is a spreadsheet value either. */
function ednNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not a finite number: ${n}`);
  return Object.is(n, -0) ? "0" : String(n);
}

export function printNode(node: Node): string {
  switch (node.kind) {
    case "number":
      return ednNumber(node.value);
    case "string":
      return ednString(node.value);
    case "boolean":
      return String(node.value);
    case "omitted":
      return "nil";
    case "array":
      return `[${node.rows.map((r) => `[${r.map(printNode).join(" ")}]`).join(" ")}]`;
    case "call":
      return `(${[node.fn, ...node.args.map(printNode)].join(" ")})`;
  }
}

export function printValue(v: Value): string {
  if (typeof v === "number") return ednNumber(v);
  if (typeof v === "string") return ednString(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map((r) => `[${r.map(printValue).join(" ")}]`).join(" ")}]`;
  return `{:error ${v.error === null ? "nil" : ednString(v.error)}}`;
}

export interface Case {
  expr: Node;
  expect: Value;
  compare?: Compare;
  /** Where in the source the case came from, e.g. `Sheet2!A2`. */
  from: string;
}

export function printCase(c: Case): string {
  const compare = c.compare ? ("round" in c.compare ? ` :round ${c.compare.round}` : ` :sig ${c.compare.sig}`) : "";
  return `{:expr ${printNode(c.expr)} :expect ${printValue(c.expect)}${compare} :from ${ednString(c.from)}}`;
}

// ---- reading

type Edn = unknown;
const OPTIONS = { mapAs: "object", keywordAs: "string", listAs: "object" } as const;

function toNode(v: Edn): Node {
  if (v === null) return { kind: "omitted" };
  if (typeof v === "number") return { kind: "number", value: v };
  if (typeof v === "string") return { kind: "string", value: v };
  if (typeof v === "boolean") return { kind: "boolean", value: v };
  if (Array.isArray(v)) {
    return { kind: "array", rows: v.map((r: Edn) => (Array.isArray(r) ? r.map(toNode) : [toNode(r)])) };
  }
  if (typeof v === "object" && "list" in v) {
    const [head, ...rest] = (v as { list: Edn[] }).list;
    if (head === null || typeof head !== "object" || !("sym" in head)) {
      throw new SyntaxError("a list must start with a function name");
    }
    return { kind: "call", fn: String((head as { sym: string }).sym), args: rest.map(toNode) };
  }
  throw new SyntaxError(`not part of the suite's expressions: ${JSON.stringify(v)}`);
}

function toValue(v: Edn): Value {
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((r: Edn) => (Array.isArray(r) ? r.map(toValue) : [toValue(r)])) as Value[][];
  if (v !== null && typeof v === "object" && "error" in v) {
    const e = (v as { error: unknown }).error;
    if (e === null || typeof e === "string") return { error: e };
  }
  throw new SyntaxError(`not an expected value: ${JSON.stringify(v)}`);
}

/** Every case in one suite file: one per line; `;` starts a comment line. */
export function readCases(text: string): Case[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith(";"))
    .map((line) => {
      const f = parseEDNString(line, OPTIONS) as { expr: Edn; expect: Edn; round?: number; sig?: number; from?: Edn };
      const compare: Compare | undefined =
        typeof f.round === "number" ? { round: f.round } : typeof f.sig === "number" ? { sig: f.sig } : undefined;
      return {
        expr: toNode(f.expr),
        expect: toValue(f.expect),
        ...(compare ? { compare } : {}),
        from: String(f.from ?? ""),
      };
    });
}
