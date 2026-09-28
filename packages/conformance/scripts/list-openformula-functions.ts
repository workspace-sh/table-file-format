// Lists OpenFormula's functions from the specification itself, so the
// report measures against the spec rather than a list someone typed.
//
//   npm run list:functions -w @workspace.sh/table-conformance
//
// Reads ODF 1.4 Part 4 and takes every function heading of section 6
// ("6.N.M NAME"), leaving out the operators of 6.4.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part4-formula.html";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../../conformance/openformula/functions.txt");

const html = await (await fetch(URL)).text();
// Whole heading elements: the HTML splits some headings across tags
// (IMSEC reads "I" + "MSEC" line by line), and some names are one letter
// (N, T).
const names = new Set<string>();
for (const h of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)) {
  const text = h[2]!
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^6\.(\d+)\.\d+ ([A-Z][A-Z0-9.]*)$/.exec(text);
  if (m && m[1] !== "4") names.add(m[2]!);
}
const sorted = [...names].sort();
writeFileSync(
  out,
  [`# OpenFormula (ODF 1.4 Part 4) functions, from the section 6 headings of`, `# ${URL}`, ...sorted.map((n) => n.toLowerCase())].join("\n") + "\n",
);
console.log(`${sorted.length} functions written to ${out}`);
