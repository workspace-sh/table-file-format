// The cases live in formulaSpans.cases.json so that every implementation of
// the scanner checks against the same list: this one, and the native
// mirrors that colour inside a platform's own text field (iOS: the glass
// bar's FormulaFieldView.swift, checked by scripts/check-formula-spans.sh).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formulaSpans } from "./formulaSpans.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, "formulaSpans.cases.json"), "utf8")) as { why: string; formula: string; spans: string[] }[];

for (const c of cases) {
  test(c.why, () => {
    assert.deepEqual(formulaSpans(c.formula).map((s) => `${s.kind}:${c.formula.slice(s.start, s.end)}`), c.spans);
  });
}
