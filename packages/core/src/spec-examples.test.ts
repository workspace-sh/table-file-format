// SPEC section 2's worked examples, checked against the evaluator.
// The examples live in docs/SPEC.md between the worked-examples markers;
// this reads them from there, so the spec and the evaluator can't
// disagree without a test failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRows, FormulaError } from "./index.js";
import type { Row, TableSchema } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const spec = readFileSync(resolve(here, "..", "..", "..", "docs", "SPEC.md"), "utf8");
const block = /<!-- worked-examples:start -->([\s\S]*?)<!-- worked-examples:end -->/.exec(spec)?.[1] ?? "";
const examples = block
  .split("\n")
  .filter((line) => line.startsWith("| `"))
  .map((line) => {
    const cells = line.split(" | ").map((c) => c.replace(/^\|\s*|\s*\|$/g, "").trim());
    const unquote = (c: string) => c.replace(/^`|`$/g, "");
    return { row: unquote(cells[0]!), expr: unquote(cells[1]!), want: cells[2]! };
  });

test("SPEC has worked examples to check", () => {
  assert.ok(examples.length >= 10, `found ${examples.length}`);
});

for (const { row, expr, want } of examples) {
  test(`SPEC example: ${expr} with ${row} → ${want}`, () => {
    const data = JSON.parse(row) as Record<string, unknown>;
    const fields = ["price", "quantity", "budget", "status", "unit price"].map((name) => ({
      name,
      type: name === "status" ? ("string" as const) : ("number" as const),
    }));
    const schema: TableSchema = {
      fields: [...fields, { name: "out", type: "number", computed: { expr, dialect: "table-expr-v1" } }],
    };
    const got = computeRows(schema, [{ id: "r", ...data } as Row]).rows[0]!.out;
    const shown =
      got === undefined ? "empty" : got instanceof FormulaError ? `\`${got.code}\`` : `\`${JSON.stringify(got)}\``;
    assert.equal(shown, want);
  });
}
