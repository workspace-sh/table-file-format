import { test } from "node:test";
import assert from "node:assert/strict";

import { bundles, tables } from "@workspace.sh/table-fixtures";
import { fromBundle } from "./bundles.ts";
import { sheetShown, showView } from "./showView.ts";

// The fixtures, keyed `bundle/table` as an app holds them.
const held = Object.assign({}, ...Object.entries(bundles).map(([key, b]) => fromBundle(key, b)));
const view = (key: string, id: string) => held[key]!.views.find((v: { id: string }) => v.id === id)!;

test("a saved view's filter and sort decide the rows", () => {
  const shown = showView(held, "crm/companies", view("crm/companies", "customers"));
  assert.deepEqual(
    shown.rows.map((r) => r.name),
    ["Atlas Freight", "Tidal Energy", "Northwind Traders"],
  );
  assert.equal(shown.inView, 3);
});

test("a search narrows what the view shows, and says how many the view had", () => {
  const shown = showView(held, "crm/companies", view("crm/companies", "all"), { search: "freight" });
  assert.deepEqual(shown.rows.map((r) => r.name), ["Atlas Freight"]);
  assert.equal(shown.inView, tables["companies"]!.rows.length);
});

test("a viewer's own sort shows over the saved view, which stays as saved", () => {
  const saved = view("crm/companies", "all");
  const shown = showView(held, "crm/companies", saved, {
    arrangement: { sort: [{ field: "employees", direction: "asc" }] },
  });
  assert.equal(shown.rows[0]!.name, "Fern Studio");
  assert.equal(shown.view.sort?.[0]?.field, "employees");
  assert.equal(saved.sort, undefined);
});

test("a Sheet view numbers its rows in its saved order; another view has no grid", () => {
  const sheet = sheetShown(held, "household-budget/ledger", view("household-budget/ledger", "by-date"));
  assert.ok(sheet);
  assert.equal(sheet.order.length, 10);
  assert.equal(sheet.position.get(sheet.order[0]!), 1);
  assert.ok(sheet.sheets.length > 0);
  assert.equal(sheetShown(held, "household-budget/ledger", view("household-budget/ledger", "as-entered")), undefined);
});
