// What the format means to support but doesn't yet: each is a test marked
// `todo`, so it reports without failing the run. When a feature lands, drop
// its `todo` and the expected values here are its acceptance test.
//
// Cross-row aggregation (totals, rollups, lookups) is deferred by D29 for
// performance: row-local formulas keep evaluation per row (#96). Multi-select
// is an `array` field whose items come from a choice list (#97).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseTable } from "./parser.js";
import { validate } from "./validator.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => parseTable(resolve(here, "..", "..", "..", "fixtures", `${name}.table`));

const OPEN = new Set(["lead", "qualified", "proposal", "negotiation"]);

test("rollup: a company's open pipeline is the sum of its open deals", { todo: "cross-row aggregation (D29)" }, async () => {
  const deals = await fixture("deals");
  // What a rollup on companies would show, worked out by hand from the fixture.
  const expected = { "co-atlas": 430000, "co-tidal": 104000, "co-northwind": 64000, "co-lumen": 22000, "co-fern": 4800 };
  const byHand: Record<string, number> = {};
  for (const d of deals.rows) if (OPEN.has(String(d.stage))) byHand[String(d.company)] = (byHand[String(d.company)] ?? 0) + Number(d.value);
  assert.deepEqual(byHand, expected);
  assert.fail("no rollup form in table-expr-v1 yet");
});

test("lookup: a deal shows its company's industry", { todo: "cross-table lookup (D29)" }, async () => {
  const [deals, companies] = await Promise.all([fixture("deals"), fixture("companies")]);
  const industry = new Map(companies.rows.map((c) => [c.id, c.industry]));
  assert.equal(industry.get(String(deals.rows.find((d) => d.id === "dl-1")!.company)), "Logistics");
  assert.fail("no lookup form in table-expr-v1 yet");
});

test("column total: the pipeline's total value", { todo: "column totals (D29, D32)" }, async () => {
  const deals = await fixture("deals");
  assert.equal(deals.rows.reduce((sum, d) => sum + Number(d.value), 0), 732800);
  assert.fail("no column-total form yet; `sum` stays within the row (D29 addendum)");
});

test("multi-select: an array field's choice list checks each item", { todo: "enum on array fields" }, () => {
  const schema = {
    fields: [{ name: "tags", type: "array" as const, constraints: { enum: ["emea", "priority"] } }],
  };
  assert.deepEqual(validate(schema, [{ id: "r1", tags: ["emea", "priority"] }]), []);
  assert.equal(validate(schema, [{ id: "r2", tags: ["emea", "nope"] }]).length, 1);
});
