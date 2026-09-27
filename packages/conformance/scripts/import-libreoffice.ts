// Imports LibreOffice's function tests into the suite, as EDN.
//
//   npm run import:libreoffice -w @workspace.sh/table-conformance -- <libreoffice-core checkout>
//
// A sparse checkout of sc/qa/unit/data/functions is enough:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/LibreOffice/core.git
//   git -C core sparse-checkout set sc/qa/unit/data/functions
//
// Each test file's Sheet2 holds one case per row: column A the formula,
// column B the expected value, column C LibreOffice's own check. This
// takes the cases whose formula holds no reference to another cell;
// the rest need their inputs brought along and come later. Every case
// keeps the cell it came from.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { type Case, printCase } from "../src/edn.js";
import type { Compare, Value } from "../src/node.js";
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
  if (!m) throw new Error(`unrecognised time ${pt}`);
  const v = (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) / 86400;
  return pt.startsWith("-") ? -v : v;
}

/** The value a cell holds, as LibreOffice last calculated it. */
function cellValue(open: string, inner: string): Value | undefined {
  const text = [...inner.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)]
    .map((m) => unescape(m[1]!.replace(/<text:s[^>]*\/>/g, " ").replace(/<[^>]+>/g, "")))
    .join("\n");
  if (attr(open, "calcext:value-type") === "error") return { error: text };
  switch (attr(open, "office:value-type")) {
    case "float":
    case "percentage":
    case "currency":
      return Number(attr(open, "office:value"));
    case "date":
      return dateSerial(attr(open, "office:date-value")!);
    case "time":
      return durationFraction(attr(open, "office:time-value")!);
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

for (const file of files) {
  const source = readFileSync(join(functions, file), "utf8");
  const sheet = /<table:table table:name="Sheet2"[\s\S]*?<\/table:table>/.exec(source)?.[0];
  if (!sheet) continue;
  const cases: Case[] = [];
  let row = 0;
  for (const r of sheet.matchAll(/<table:table-row([^>]*)>([\s\S]*?)<\/table:table-row>/g)) {
    row += Number(attr(r[1]!, "table:number-rows-repeated") ?? 1);
    const cells = [...r[2]!.matchAll(/<table:table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)];
    const [a, b, c] = cells;
    if (!a || !b) continue;
    const formula = attr(a[1]!, "table:formula");
    if (!formula?.startsWith("of:=")) continue;
    const from = `Sheet2!A${row}`;
    let expr;
    try {
      expr = readOpenFormula(formula);
    } catch (e) {
      if (e instanceof Unsupported) {
        if (e.message === "a reference") tally.references++;
        else if (e.message === "an error literal") tally.errorLiterals++;
        else tally.named++;
      } else tally.unreadable.push(`${file} ${from}: ${formula}`);
      continue;
    }
    const check = readCheck(c ? attr(c[1]!, "table:formula") : undefined, row);
    if (check === undefined) {
      tally.otherChecks++;
      continue;
    }
    const expect = check.error !== undefined ? { error: check.error } : cellValue(b[1]!, b[2] ?? "");
    if (expect === undefined) {
      tally.noExpected++;
      continue;
    }
    cases.push({ expr, expect, ...(check.compare ? { compare: check.compare } : {}), from });
  }
  if (cases.length === 0) continue;
  const target = join(out, file.replace(/\/fods\//, "/").replace(/\.fods$/, ".edn"));
  mkdirSync(dirname(target), { recursive: true });
  const header = [
    `; From LibreOffice core ${commit}, sc/qa/unit/data/functions/${file}`,
    "; Mozilla Public License 2.0 (see ../LICENSE). Generated by packages/conformance/scripts/import-libreoffice.ts.",
  ];
  writeFileSync(target, [...header, ...cases.map(printCase)].join("\n") + "\n");
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
