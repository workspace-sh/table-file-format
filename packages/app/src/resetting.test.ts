import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { afterReset, resetPrompt } from "./resetting.ts";

const t = (title: string, rows = 0): ParsedTable => ({
  path: title,
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })),
  views: [{ id: "v", name: "All", layout: "table" }],
  meta: { title },
});

test("the question says edits go, and mentions opened folders only where there are some", () => {
  const web = resetPrompt({ openedFolders: false });
  assert.equal(web.heading, "Reset the demo data?");
  assert.equal(web.body, "Every edit you made here is lost.");
  assert.match(resetPrompt({ openedFolders: true }).body, / Folders you opened from disk aren't touched\.$/);
  assert.deepEqual(web.responses.map((r) => [r.id, r.destructive ?? false]), [["cancel", false], ["reset", true]]);
});

test("after a reset: the examples as they shipped, opened folders as they are, nothing else", () => {
  const examples = { tables: { "crm/deals": t("Deals", 8) }, bundles: { crm: { title: "CRM" } } };
  const held = {
    "crm/deals": t("Deals", 3),
    "crm/leads": t("Leads"),
    "notes/notes": t("Notes"),
    "mine/budget": t("Budget", 5),
  };
  const bundles = { crm: { title: "CRM", tables: ["deals", "leads"] }, notes: { title: "Notes" }, mine: { title: "Mine" } };
  const after = afterReset(held, bundles, examples, ["mine"]);
  assert.deepEqual(Object.keys(after.tables).sort(), ["crm/deals", "mine/budget"]);
  assert.equal(after.tables["crm/deals"], examples.tables["crm/deals"]);
  assert.equal(after.tables["mine/budget"], held["mine/budget"]);
  assert.deepEqual(after.bundles, { crm: { title: "CRM" }, mine: { title: "Mine" } });
  assert.equal(afterReset(held, bundles, examples, []), examples, "nothing kept: the examples themselves");
});
