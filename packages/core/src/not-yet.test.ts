// What the format means to support but doesn't yet: each is a test marked
// `todo`, so it reports without failing the run. When a feature lands, drop
// its `todo`, make it compute the value with the new form, and the value
// here is its acceptance test.
//
// Cross-row aggregation (totals, rollups, lookups) is deferred by D29 for
// performance: row-local formulas keep evaluation per row (#96). Multi-select
// is an `array` field whose items come from a choice list (#97).
//
// A todo test's failures are hidden, so a wrong expected value would hide
// too. Each value is therefore worked out by hand from the fixtures in an
// ordinary test first: if a fixture or a number is wrong, that one fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseTable } from "./parser.js";
import { validate } from "./validator.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => parseTable(resolve(here, "..", "..", "..", "fixtures", `${name}.table`));

const OPEN = new Set(["lead", "qualified", "proposal", "negotiation"]);

/** What each feature, once built, must produce from the fixtures. */
const EXPECTED = {
  /** Rollup on companies: the sum of each company's open deals. */
  openPipeline: { "co-atlas": 430000, "co-tidal": 104000, "co-northwind": 64000, "co-lumen": 22000, "co-fern": 4800 },
  /** Lookup on deals: dl-1's company's industry. */
  dealIndustry: "Logistics",
  /** Column total over deals' value. */
  pipelineTotal: 732800,
  /** Column total over the budget's spending rows' Q1. */
  quarterSpending: 8313,
  /** Rent's Q1 as a share of that total, to three places. */
  rentShareOfSpending: 0.523,
};

test("the values the not-yet tests expect are right for the fixtures", async () => {
  const [deals, companies, budget] = await Promise.all([fixture("deals"), fixture("companies"), fixture("household-budget")]);
  const pipeline: Record<string, number> = {};
  for (const d of deals.rows) if (OPEN.has(String(d.stage))) pipeline[String(d.company)] = (pipeline[String(d.company)] ?? 0) + Number(d.value);
  assert.deepEqual(pipeline, EXPECTED.openPipeline);
  const industry = new Map(companies.rows.map((c) => [c.id, c.industry]));
  assert.equal(industry.get(String(deals.rows.find((d) => d.id === "dl-1")!.company)), EXPECTED.dealIndustry);
  assert.equal(deals.rows.reduce((sum, d) => sum + Number(d.value), 0), EXPECTED.pipelineTotal);
  const q1 = (r: Record<string, unknown>) => Number(r.jan) + Number(r.feb) + Number(r.mar);
  const spending = budget.rows.filter((r) => r.category !== "Income");
  assert.equal(spending.reduce((sum, r) => sum + q1(r), 0), EXPECTED.quarterSpending);
  const rent = budget.rows.find((r) => r.id === "rent")!;
  assert.equal(Math.round((q1(rent) / EXPECTED.quarterSpending) * 1000) / 1000, EXPECTED.rentShareOfSpending);
});

test("rollup: a company's open pipeline is the sum of its open deals", { todo: "cross-row aggregation (#96)" }, () => {
  assert.fail(`no rollup form in table-expr-v1 yet; expected ${JSON.stringify(EXPECTED.openPipeline)}`);
});

test("lookup: a deal shows its company's industry", { todo: "cross-table lookup (#96)" }, () => {
  assert.fail(`no lookup form in table-expr-v1 yet; expected ${EXPECTED.dealIndustry}`);
});

test("column total: the pipeline's total value", { todo: "column totals (#96)" }, () => {
  assert.fail(`no column-total form yet; \`sum\` stays within the row (D29 addendum); expected ${EXPECTED.pipelineTotal}`);
});

test("sheet total: the budget's spending for the quarter", { todo: "column totals (#96)" }, () => {
  assert.fail(`no column-total form yet; expected a Total of ${EXPECTED.quarterSpending} under Q1`);
});

test("sheet share: each line as a share of total spending", { todo: "column totals (#96)" }, () => {
  assert.fail(`needs the column total; expected rent at ${EXPECTED.rentShareOfSpending}`);
});
