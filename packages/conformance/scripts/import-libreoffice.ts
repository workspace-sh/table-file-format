// Imports LibreOffice's function tests into the suite, as EDN.
//
//   npm run import:libreoffice -w @workspace.sh/table-conformance -- <libreoffice-core checkout>
//
// A sparse checkout of sc/qa/unit/data/functions is enough:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/LibreOffice/core.git
//   git -C core sparse-checkout set sc/qa/unit/data/functions
//
// Each test file's Sheet2 holds one case per row: column A the formula,
// column B the expected value, column C LibreOffice's own check. A
// formula that reads cells on that sheet carries their values with the
// case. Every case keeps the cell it came from.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { type Case, printCase, printHost } from "../src/edn.js";
import type { Compare, Host, Node, Value } from "../src/node.js";
import { readOpenFormula, Unsupported } from "../src/openformula.js";

const checkout = process.argv[2];
if (!checkout) {
  console.error("usage: import-libreoffice <libreoffice-core checkout>");
  process.exit(1);
}
const functions = join(checkout, "sc/qa/unit/data/functions");
const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../../conformance/openformula/libreoffice");

const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const attr = (cell: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(cell);
  return m ? unescape(m[1]!) : undefined;
};

// Dates and times are numbers in OpenFormula (4.3.2, 4.3.3): days since
// 1899-12-30, the default null date, and a time as a fraction of a day.
const DAY = 86_400_000;
const NULL_DATE = Date.UTC(1899, 11, 30);
function dateSerial(iso: string): number {
  const [d, t] = iso.split("T");
  const [y, m, day] = d!.split("-").map(Number);
  let serial = (Date.UTC(y!, m! - 1, day!) - NULL_DATE) / DAY;
  if (t) serial += timeFraction(t);
  return serial;
}
function timeFraction(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) / 86400;
}
function durationFraction(pt: string): number {
  const m = /^-?PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(pt);
  if (!m) throw new Error(`unrecognised time ${JSON.stringify(pt)}`);
  const v = (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) / 86400;
  return pt.startsWith("-") ? -v : v;
}

/** The value a cell holds, as LibreOffice last calculated it. */
function cellValue(open: string, inner: string): Value | undefined {
  // ODF's text markup: <text:s text:c="N"/> is N spaces, <text:tab/> a
  // tab, <text:line-break/> a new line, and each paragraph a line.
  const text = [...inner.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)]
    .map((m) =>
      unescape(
        m[1]!
          .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n?: string) => " ".repeat(Number(n ?? 1)))
          .replace(/<text:tab\s*\/>/g, "\t")
          .replace(/<text:line-break\s*\/>/g, "\n")
          .replace(/<[^>]+>/g, ""),
      ),
    )
    .join("\n");
  if (attr(open, "calcext:value-type") === "error") return { error: text };
  switch (attr(open, "office:value-type")) {
    case "float":
    case "percentage":
    case "currency":
      return Number(attr(open, "office:value"));
    case "date": {
      const d = attr(open, "office:date-value");
      return d === undefined ? undefined : dateSerial(d);
    }
    case "time": {
      const d = attr(open, "office:time-value");
      return d === undefined ? undefined : durationFraction(d);
    }
    case "boolean":
      return attr(open, "office:boolean-value") === "true";
    case "string":
      return attr(open, "office:string-value") ?? text;
    default:
      return undefined;
  }
}

// ERROR.TYPE's numbering (OpenFormula 6.13.11).
const ERROR_TYPES: Record<string, string> = {
  "1": "#NULL!", "2": "#DIV/0!", "3": "#VALUE!", "4": "#REF!", "5": "#NAME?", "6": "#NUM!", "7": "#N/A",
};

/**
 * What LibreOffice's check (column C) asks of the row's answer. It
 * decides how the case compares, or that it only asks for an error.
 * Undefined: a check this importer doesn't read yet.
 */
function readCheck(check: string | undefined, row: number): { compare?: Compare; error?: string | null } | undefined {
  if (check === undefined) return {};
  const c = check.replace(/^of:=/, "").replace(/\[(?:Sheet\d+)?\./g, "[.").replace(/\s+/g, "");
  const a = `[.A${row}]`, b = `[.B${row}]`;
  if (c === `${a}=${b}` || c === `(${a}=${b})` || c === `${b}=${a}`) return {};
  let m = /^ROUND\(\[\.A(\d+)\];(\d+)\)=ROUND\(\[\.B(\d+)\];(\d+)\)$/.exec(c);
  if (m && Number(m[1]) === row && Number(m[3]) === row && m[2] === m[4]) return { compare: { round: Number(m[2]) } };
  m = /^ORG\.LIBREOFFICE\.ROUNDSIG\(\[\.A(\d+)\];(\d+)\)=ORG\.LIBREOFFICE\.ROUNDSIG\(\[\.B(\d+)\];(\d+)\)$/.exec(c);
  if (m && Number(m[1]) === row && Number(m[3]) === row && m[2] === m[4]) return { compare: { sig: Number(m[2]) } };
  if (c === `ISERROR(${a})`) return { error: null };
  if (c === `ISNA(${a})`) return { error: "#N/A" };
  m = /^(?:ERROR\.TYPE|ORG\.OPENOFFICE\.ERRORTYPE)\(\[\.A(\d+)\]\)=(\d)$/.exec(c);
  if (m && Number(m[1]) === row && ERROR_TYPES[m[2]!]) return { error: ERROR_TYPES[m[2]!]! };
  return undefined;
}

interface Tally {
  imported: number;
  references: number;
  errorLiterals: number;
  named: number;
  noExpected: number;
  otherChecks: number;
  unreadable: string[];
}
const tally: Tally = {
  imported: 0, references: 0, errorLiterals: 0, named: 0, noExpected: 0, otherChecks: 0, unreadable: [],
};

rmSync(out, { recursive: true, force: true });
const files: string[] = [];
for (const category of readdirSync(functions).sort()) {
  let names: string[];
  try {
    names = readdirSync(join(functions, category, "fods"));
  } catch {
    continue;
  }
  for (const name of names.filter((n) => n.endsWith(".fods")).sort()) files.push(join(category, "fods", name));
}

function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function* cellsIn(range: string): Generator<string> {
  const [from, to = from] = range.split(":");
  const at = (a: string) => {
    const m = /^([A-Z]+)([0-9]+)$/.exec(a)!;
    const col = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { col, row: Number(m[2]) };
  };
  const a = at(from!), b = at(to);
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) yield `${columnName(c)}${r}`;
  }
}

function refsIn(node: Node): string[] {
  if (node.kind === "call") {
    if (node.fn === "ref" && node.args[0]?.kind === "string") return [node.args[0].value];
    return node.args.flatMap(refsIn);
  }
  if (node.kind === "array") return node.rows.flat().flatMap(refsIn);
  return [];
}

// A case may read at most this many cells; larger ranges are left for later.
const MAX_CELLS = 2000;

/**
 * The document's host settings (OpenFormula 3.4), from its
 * <table:calculation-settings>, with ODF's defaults for what it leaves out.
 */
function readHost(source: string): Host {
  const s = /<table:calculation-settings([^>]*)/.exec(source)?.[1] ?? "";
  const flag = (name: string, dflt: boolean) => {
    const v = attr(s, `table:${name}`);
    return v === undefined ? dflt : v === "true";
  };
  return {
    caseSensitive: flag("case-sensitive", true),
    wholeCell: flag("search-criteria-must-apply-to-whole-cell", true),
    regex: flag("use-regular-expressions", true),
    wildcards: flag("use-wildcards", false),
  };
}

interface SheetCell {
  open: string;
  inner: string;
}

/** Every cell of a sheet by address, with repeated rows and columns spread out. */
function readSheet(sheet: string): { rows: Map<number, SheetCell[]>; values: Map<string, Value> } {
  const rows = new Map<number, SheetCell[]>();
  const values = new Map<string, Value>();
  let row = 0;
  for (const r of sheet.matchAll(/<table:table-row([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const repeat = Number(attr(r[1]!, "table:number-rows-repeated") ?? 1);
    const cells: SheetCell[] = [];
    for (const c of (r[2] ?? "").matchAll(
      /<table:(?:covered-)?table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g,
    )) {
      const n = Math.min(Number(attr(c[1]!, "table:number-columns-repeated") ?? 1), 1024);
      for (let i = 0; i < n; i++) cells.push({ open: c[1]!, inner: c[2] ?? "" });
    }
    for (let k = 0; k < Math.min(repeat, 64); k++) {
      row++;
      rows.set(row, cells);
      cells.forEach((cell, col) => {
        const v = cellValue(cell.open, cell.inner);
        if (v !== undefined) values.set(`${columnName(col)}${row}`, v);
      });
    }
    row += Math.max(0, repeat - 64);
  }
  return { rows, values };
}

for (const file of files) {
  const source = readFileSync(join(functions, file), "utf8");
  const sheet = /<table:table table:name="Sheet2"[\s\S]*?<\/table:table>/.exec(source)?.[0];
  if (!sheet) continue;
  const grid = readSheet(sheet);
  const host = readHost(source);
  const cases: Case[] = [];
  for (const [row, [a, b, c]] of grid.rows) {
    if (!a || !b) continue;
    const formula = attr(a.open, "table:formula");
    if (!formula?.startsWith("of:=")) continue;
    const from = `Sheet2!A${row}`;
    let expr: Node;
    try {
      expr = readOpenFormula(formula);
    } catch (e) {
      if (e instanceof Unsupported) {
        if (e.message.startsWith("a reference") || e.message.startsWith("a whole")) tally.references++;
        else if (e.message === "an error literal") tally.errorLiterals++;
        else tally.named++;
      } else tally.unreadable.push(`${file} ${from}: ${formula}`);
      continue;
    }
    const check = readCheck(c ? attr(c.open, "table:formula") : undefined, row);
    if (check === undefined) {
      tally.otherChecks++;
      continue;
    }
    const expect = check.error !== undefined ? { error: check.error } : cellValue(b.open, b.inner);
    if (expect === undefined) {
      tally.noExpected++;
      continue;
    }
    let cells: Record<string, Value> | undefined;
    const refs = refsIn(expr);
    if (refs.length > 0) {
      const addresses = new Set<string>();
      let tooMany = false;
      for (const ref of refs) {
        for (const addr of cellsIn(ref)) {
          addresses.add(addr);
          if (addresses.size > MAX_CELLS) tooMany = true;
        }
        if (tooMany) break;
      }
      if (tooMany) {
        tally.references++;
        continue;
      }
      cells = {};
      for (const addr of addresses) {
        const v = grid.values.get(addr);
        if (v !== undefined) cells[addr] = v;
      }
    }
    cases.push({
      expr,
      expect,
      ...(check.compare ? { compare: check.compare } : {}),
      ...(cells ? { cells } : {}),
      host,
      from,
    });
  }
  if (cases.length === 0) continue;
  const target = join(out, file.replace(/\/fods\//, "/").replace(/\.fods$/, ".edn"));
  mkdirSync(dirname(target), { recursive: true });
  const header = [
    `; From LibreOffice core ${commit}, sc/qa/unit/data/functions/${file}`,
    "; Mozilla Public License 2.0 (see ../LICENSE). Generated by packages/conformance/scripts/import-libreoffice.ts.",
  ];
  writeFileSync(target, [...header, printHost(host), ...cases.map(printCase)].join("\n") + "\n");
  tally.imported += cases.length;
}

writeFileSync(
  join(out, "SOURCE.json"),
  JSON.stringify(
    {
      repository: "https://github.com/LibreOffice/core",
      commit,
      path: "sc/qa/unit/data/functions",
      licence: "MPL-2.0",
      imported: tally.imported,
      leftForLater: {
        references: tally.references,
        errorLiterals: tally.errorLiterals,
        namedExpressions: tally.named,
        noExpectedValue: tally.noExpected,
        checksNotReadYet: tally.otherChecks,
        unreadable: tally.unreadable.length,
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(`imported ${tally.imported} cases into ${relative(process.cwd(), out)}`);
console.log(
  `left for later: ${tally.references} with references, ${tally.errorLiterals} with error literals, ` +
    `${tally.named} with named expressions, ${tally.noExpected} without an expected value, ` +
    `${tally.otherChecks} with checks not read yet, ${tally.unreadable.length} unreadable`,
);
for (const u of tally.unreadable.slice(0, 20)) console.log(`  unreadable: ${u}`);
