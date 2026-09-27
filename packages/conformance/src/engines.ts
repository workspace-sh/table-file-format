// The engines the suite measures. Each takes a case's expression and
// gives a value, or says it can't express it at all.

import { computeRows, FormulaError, parseExpr } from "@workspace.sh/table-core";
import { Workbook } from "formualizer/pkg/formualizer_wasm.js";

import { printNode } from "./edn.js";
import type { Node, Value } from "./node.js";

export interface Engine {
  name: string;
  /** The version measured, for the report. */
  version: string;
  evaluate(expr: Node): Value | { cannotExpress: string };
}

// ---- Formualizer, through Excel's formula text

const ERROR = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|GETTING_DATA|ERROR!)$/;
const ISO_DATE = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d(?:\.\d+)?)Z$/;
const NULL_DATE = Date.UTC(1899, 11, 30);

const INFIX = new Set(["+", "-", "*", "/", "=", "<>", "<", "<=", ">", ">=", "&"]);

/**
 * A case's expression as Excel formula text, for an engine that reads
 * Excel. OpenFormula's `COM.MICROSOFT.` names are Excel's own names.
 */
export function toExcel(node: Node): string {
  switch (node.kind) {
    case "number":
      return String(node.value).replace("e", "E");
    case "string":
      return `"${node.value.replace(/"/g, '""')}"`;
    case "boolean":
      return node.value ? "TRUE" : "FALSE";
    case "omitted":
      return "";
    case "array":
      return `{${node.rows.map((r) => r.map(toExcel).join(",")).join(";")}}`;
    case "call": {
      const a = node.args.map(toExcel);
      if (node.fn === "%" && a.length === 1) return `(${a[0]})%`;
      if ((node.fn === "-" || node.fn === "+") && a.length === 1) return `(${node.fn}${a[0]})`;
      if (INFIX.has(node.fn) && a.length >= 2) return `(${a.join(node.fn)})`;
      const name = node.fn.replace(/^com\.microsoft\./, "").toUpperCase();
      return `${name}(${a.join(",")})`;
    }
  }
}

function fromFormualizer(v: unknown): Value {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    if (ERROR.test(v)) return { error: v };
    const d = ISO_DATE.exec(v);
    if (d) {
      const [, y, m, day, h, min, s] = d;
      const ms = Date.UTC(Number(y), Number(m) - 1, Number(day), Number(h), Number(min), 0) + Number(s) * 1000;
      return (ms - NULL_DATE) / 86_400_000;
    }
    return v;
  }
  if (v instanceof Date) return (v.getTime() - NULL_DATE) / 86_400_000;
  if (v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.map((r) => (Array.isArray(r) ? r.map(fromFormualizer) : [fromFormualizer(r)])) as Value[][];
  return { error: `unrecognised result ${JSON.stringify(v)}` };
}

export function formualizer(version: string): Engine {
  const wb = new Workbook();
  let n = 0;
  return {
    name: "Formualizer",
    version,
    evaluate(expr) {
      // A sheet of its own, so an array result has room to spill.
      const sheet = `c${n++}`;
      wb.addSheet(sheet);
      try {
        wb.setFormula(sheet, 1, 1, `=${toExcel(expr)}`);
        const top = wb.evaluateCell(sheet, 1, 1);
        return fromFormualizer(top);
      } catch (e) {
        return { error: `threw: ${String(e).slice(0, 80)}` };
      }
    },
  };
}

// ---- table-core's own evaluator (SPEC section 2 as it stands)

export function tableCore(version: string): Engine {
  return {
    name: "table-core",
    version,
    evaluate(expr) {
      const text = printNode(expr);
      const parsed = parseExpr(text);
      if (!parsed.ok) return { cannotExpress: parsed.message };
      const { rows } = computeRows(
        { fields: [{ name: "x", type: "any" as never, computed: { expr: text, dialect: "table-expr-v1" } }] },
        [{ id: "r" }],
      );
      const v: unknown = rows[0]!.x;
      if (v instanceof FormulaError) return { error: v.code };
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
      if (v === undefined || v === null) return 0;
      return { error: `unrecognised result ${JSON.stringify(v)}` };
    },
  };
}
