import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundle } from "./io.js";
import { nodeFs } from "./node-fs.js";
import { renameField, renameProblem } from "./renameField.js";
import type { ParsedTable } from "./types.js";
import { computeRows } from "./workbook.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");
const tablesOf = async (name: string) => (await readBundle(nodeFs, join(fixtures, `${name}.table`))).tables;

/** Every table's rows with their formulas worked out, the field `as` read under its old name, so before and after compare. */
function computed(tables: Record<string, ParsedTable>, rename?: { table: string; from: string; to: string }): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [name, t] of Object.entries(tables)) {
    const { rows } = computeRows(t.schema, t.rows, { tables, self: name });
    out[name] = rows.map((r) => {
      if (!rename || name !== rename.table || !(rename.to in r)) return r;
      const { [rename.to]: v, ...rest } = r;
      return { ...rest, [rename.from]: v };
    });
  }
  return out;
}

const formulaOf = (t: ParsedTable, field: string) => t.schema.fields.find((f) => f.name === field)?.computed?.expr;

test("a field read through a relation is renamed in the formulas that follow it, and every result is as it was", async () => {
  const tables = await tablesOf("crm");
  const before = computed(tables);
  const after = renameField(tables, "companies", "industry", "sector");
  // The companies' own: the field, its values, its views (By industry groups and boards by it).
  assert.ok(after.companies!.schema.fields.some((f) => f.name === "sector"));
  assert.ok(!after.companies!.schema.fields.some((f) => f.name === "industry"));
  assert.ok(after.companies!.rows.every((r) => !("industry" in r)));
  assert.equal(after.companies!.rows[0]!.sector, tables.companies!.rows[0]!.industry);
  assert.ok(!JSON.stringify(after.companies!.views).includes('"industry"'));
  // Deals read it through their relation `company`; deals' own field of the same name is theirs, and stays.
  assert.equal(formulaOf(after.deals!, "industry"), '(related "company" "sector")');
  assert.ok(after.deals!.schema.fields.some((f) => f.name === "industry"));
  assert.deepEqual(computed(after, { table: "companies", from: "industry", to: "sector" }), before);
  // The field keeps its id: an address made before the rename still finds it.
  assert.equal(after.companies!.schema.fields.find((f) => f.name === "sector")!.id, tables.companies!.schema.fields.find((f) => f.name === "industry")!.id);
  // A table it changes nothing in is the same table.
  assert.equal(after.contacts, tables.contacts);
});

test("a relation field renamed: the formulas that follow it, and the linked tables that read through it", async () => {
  const tables = await tablesOf("crm");
  const before = computed(tables);
  const after = renameField(tables, "deals", "company", "account");
  assert.equal(formulaOf(after.deals!, "industry"), '(related "account" "industry")');
  assert.equal(formulaOf(after.deals!, "company_pipeline"), '(related "account" "open_pipeline")');
  assert.equal(formulaOf(after.companies!, "open_pipeline"), '(sum (linked "deals" "account" "open_value"))');
  assert.equal(formulaOf(after.companies!, "deal_count"), '(count (linked "deals" "account" "title"))');
  assert.ok(after.deals!.rows.every((r) => !("company" in r) && "account" in r));
  assert.deepEqual(computed(after, { table: "deals", from: "company", to: "account" }), before);
});

test("a computed field renamed is renamed in the formulas that read it, in its table and through links", async () => {
  const tables = await tablesOf("shop");
  const before = computed(tables);
  const after = renameField(tables, "lines", "line_total", "amount");
  assert.equal(formulaOf(after.orders!, "subtotal"), '(sum (linked "lines" "order" "amount"))');
  assert.equal(formulaOf(after.products!, "revenue"), '(sum (linked "lines" "product" "amount"))');
  assert.deepEqual(computed(after, { table: "lines", from: "line_total", to: "amount" }), before);
  // Formulas that don't read it are left as they were, to the byte.
  assert.equal(formulaOf(after.orders!, "total"), formulaOf(tables.orders!, "total"));
});

test("a name that can't be a bare word is read as (field \"…\")", async () => {
  const tables = await tablesOf("shop");
  const before = computed(tables);
  const after = renameField(tables, "lines", "quantity", "qty sold");
  assert.equal(formulaOf(after.lines!, "line_total"), '(* (field "qty sold") unit_price)');
  assert.equal(formulaOf(after.orders!, "items"), '(sum (linked "lines" "order" "qty sold"))');
  assert.deepEqual(computed(after, { table: "lines", from: "quantity", to: "qty sold" }), before);
});

test("a field read by place in a Sheet view: its own formula, and the view, renamed; the running balance as it was", async () => {
  const tables = await tablesOf("household-budget");
  const before = computed(tables);
  const after = renameField(tables, "ledger", "balance", "running");
  assert.equal(formulaOf(after.ledger!, "running"), '(sum (at "running" -1 "87jkeekgwbfgr") amount)');
  const byDate = after.ledger!.views.find((v) => v.id === "87jkeekgwbfgr")!;
  assert.ok(byDate.fields!.includes("running") && "running" in byDate.columnWidths!);
  assert.deepEqual(computed(after, { table: "ledger", from: "balance", to: "running" }), before);
  // And a field the place formula reads as its plain argument.
  const amount = renameField(tables, "ledger", "amount", "spent");
  assert.equal(formulaOf(amount.ledger!, "balance"), '(sum (at "balance" -1 "87jkeekgwbfgr") spent)');
  assert.deepEqual(computed(amount, { table: "ledger", from: "amount", to: "spent" }), before);
});

test("what a field can't be renamed to says why, and nothing changes", async () => {
  const tables = await tablesOf("crm");
  assert.equal(renameProblem(tables.deals!, "value", "stage"), "There's already a field “stage”.");
  assert.equal(renameProblem(tables.deals!, "value", " "), "A field needs a name.");
  assert.equal(renameProblem(tables.deals!, "value", "id"), "“id” is every row's own id.");
  assert.equal(renameProblem(tables.deals!, "nope", "x"), "There's no field “nope”.");
  assert.equal(renameProblem(tables.deals!, "value", "amount"), null);
  assert.equal(renameField(tables, "deals", "value", "stage"), tables);
});

test("every place a table names a field: cells' own formulas, colour rules, merges, calendars, ranges, keys and relations", () => {
  const view = (over: Record<string, unknown>) => ({ id: "v", name: "V", layout: "table", ...over }) as ParsedTable["views"][number];
  const tables: Record<string, ParsedTable> = {
    a: {
      schema: { fields: [{ name: "code", type: "string" }, { name: "n", type: "number" }, { name: "end", type: "date" }], primaryKey: ["code"] },
      rows: [{ id: "r1", code: "x", n: 1 }],
      views: [
        view({
          colors: [{ filter: [{ field: "code", op: "eq", value: "x" }], color: "red", field: "code" }],
          merged: [{ from: { field: "code", row: "r1" }, to: { field: "n", row: "r1" } }],
          calendar_range: { start: "code", end: "end" },
          totals: { code: "count" },
          coordinates: true,
        }),
      ],
      meta: {},
      cells: [{ id: "r1", field: "n", expr: '(sum (range "code" 1 "n" 2 "v"))' }, { id: "r1", field: "code", note: "a note" }],
    },
    b: {
      schema: { fields: [{ name: "a", type: "string", relation: { table: "a", field: "code" } }, { name: "where", type: "string", computed: { dialect: "table-expr-v1", expr: '(at "code" 1 "v" "a")' } }] },
      rows: [],
      views: [],
      meta: {},
    },
  };
  const after = renameField(tables, "a", "code", "key");
  const a = after.a!;
  assert.deepEqual(a.schema.primaryKey, ["key"]);
  assert.equal(a.cells![0]!.expr, '(sum (range "key" 1 "n" 2 "v"))');
  assert.equal(a.cells![1]!.field, "key");
  const v = a.views[0]!;
  assert.equal(v.colors![0]!.field, "key");
  assert.equal(v.colors![0]!.filter[0]!.field, "key");
  assert.equal(v.merged![0]!.from.field, "key");
  assert.deepEqual(v.calendar_range, { start: "key", end: "end" });
  assert.deepEqual(v.totals, { key: "count" });
  const b = after.b!;
  assert.deepEqual(b.schema.fields[0]!.relation, { table: "a", field: "key" });
  assert.equal(b.schema.fields[1]!.computed!.expr, '(at "key" 1 "v" "a")');
});
