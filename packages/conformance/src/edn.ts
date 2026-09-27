// The suite's files are EDN: one case per line,
//   {:expr (round 2.348 2) :expect 2.35 :from "Sheet2!A2"}
// `:expr` is the stored form of SPEC section 2. `:expect` is a number,
// string or boolean, `[[…]]` for an array, `{:error "#N/A"}`, or
// `{:error nil}` for any error. `:round 12` or `:sig 10` compares
// numbers rounded, as the source's own check did. A case whose formula
// reads cells, `(ref "A1:B3")`, carries their values in `:cells`,
// `{"A1" 1 "B2" "x"}`; a cell not listed is empty.
//
// A file may start with the host settings its cases were written under
// (OpenFormula 3.4), applying to every case after it:
//   {:host {:case-sensitive true :whole-cell true :regex true :wildcards false}}
// Without one, a case is under `.table`'s own host settings.

import { parseEDNString } from "edn-data";
import { type Compare, type Host, type Node, type Value, TABLE_HOST } from "./node.js";

// ---- printing

/** An EDN string. Control characters are escaped, so none is invisible in a file. */
function ednString(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${escaped}"`;
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
  /** The values of the cells the formula reads, by address. */
  cells?: Record<string, Value>;
  /** The host settings the case was written under. */
  host: Host;
  /** Where in the source the case came from, e.g. `Sheet2!A2`. */
  from: string;
}

export function printHost(h: Host): string {
  return `{:host {:case-sensitive ${h.caseSensitive} :whole-cell ${h.wholeCell} :regex ${h.regex} :wildcards ${h.wildcards}}}`;
}

/** One case's line. Its host settings go once, at the top of the file (printHost). */
export function printCase(c: Case): string {
  const compare = c.compare ? ("round" in c.compare ? ` :round ${c.compare.round}` : ` :sig ${c.compare.sig}`) : "";
  const cells = c.cells
    ? ` :cells {${Object.entries(c.cells)
        .map(([k, v]) => `${ednString(k)} ${printValue(v)}`)
        .join(" ")}}`
    : "";
  return `{:expr ${printNode(c.expr)} :expect ${printValue(c.expect)}${compare}${cells} :from ${ednString(c.from)}}`;
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
  let host: Host = TABLE_HOST;
  const cases: Case[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith(";")) continue;
    const f = parseEDNString(line, OPTIONS) as {
      host?: Record<string, boolean>;
      expr: Edn;
      expect: Edn;
      round?: number;
      sig?: number;
      cells?: Record<string, Edn>;
      from?: Edn;
    };
    if (f.host) {
      host = {
        caseSensitive: f.host["case-sensitive"] === true,
        wholeCell: f.host["whole-cell"] === true,
        regex: f.host.regex === true,
        wildcards: f.host.wildcards === true,
      };
      continue;
    }
    const compare: Compare | undefined =
      typeof f.round === "number" ? { round: f.round } : typeof f.sig === "number" ? { sig: f.sig } : undefined;
    cases.push({
      expr: toNode(f.expr),
      expect: toValue(f.expect),
      ...(compare ? { compare } : {}),
      ...(f.cells ? { cells: Object.fromEntries(Object.entries(f.cells).map(([k, v]) => [k, toValue(v)])) } : {}),
      host,
      from: String(f.from ?? ""),
    });
  }
  return cases;
}
