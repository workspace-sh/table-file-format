// The engines the suite measures. Each takes a case's expression and
// gives a value, or says it can't express it at all.

import { computeRows, FormulaError, parseExpr } from "@workspace.sh/table-core";
import { Workbook } from "formualizer/pkg/formualizer_wasm.js";

import { type Case, printNode } from "./edn.js";
import { type Host, type Node, type Value, TABLE_HOST } from "./node.js";

export interface Engine {
  name: string;
  /** The version measured, for the report. */
  version: string;
  /** The host settings it computes under (OpenFormula 3.4). */
  host: Host;
  evaluate(c: Case): Value | { cannotExpress: string };
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
      if (node.fn === "ref" && node.args[0]?.kind === "string") return node.args[0].value;
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

function address(a: string): { row: number; col: number } {
  const m = /^([A-Z]+)([0-9]+)$/.exec(a);
  if (!m) throw new Error(`not a cell address: ${a}`);
  const col = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { row: Number(m[2]), col };
}

// A cell holding an error is set by a formula that gives it.
const ERROR_FORMULAS: Record<string, string> = {
  "#N/A": "=NA()",
  "#DIV/0!": "=1/0",
  "#VALUE!": '="a"+1',
  "#NUM!": "=SQRT(-1)",
  "#NAME?": "=NO.SUCH.FUNCTION()",
  "#REF!": "=INDEX({1},2)",
};

export function formualizer(version: string): Engine {
  let wb = new Workbook();
  let n = 0;
  return {
    name: "Formualizer",
    version,
    // Excel's behaviour: case-insensitive, wildcards, whole-cell matching.
    host: TABLE_HOST,
    evaluate(c) {
      // A sheet of its own, so an array result has room to spill, with
      // the cells the case reads and the formula where the case had it.
      // A fresh workbook now and then: one that keeps growing slows every case.
      if (n % 100 === 0) wb = new Workbook();
      const sheet = `c${n++}`;
      wb.addSheet(sheet);
      try {
        for (const [addr, v] of Object.entries(c.cells ?? {})) {
          const { row, col } = address(addr);
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            const f = v.error ? ERROR_FORMULAS[v.error] : undefined;
            if (f) wb.setFormula(sheet, row, col, f);
          } else if (!Array.isArray(v)) wb.setValue(sheet, row, col, v);
        }
        const at = address(c.from.replace(/^.*!/, "") || "A1");
        wb.setFormula(sheet, at.row, at.col, `=${toExcel(c.expr)}`);
        return fromFormualizer(wb.evaluateCell(sheet, at.row, at.col));
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
    host: TABLE_HOST,
    evaluate(c) {
      if (c.cells) return { cannotExpress: "reads cells" };
      const text = printNode(c.expr);
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
