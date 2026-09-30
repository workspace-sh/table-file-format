import { test } from "node:test";
import assert from "node:assert/strict";

import { leaving } from "./leaving.ts";
import { viewAddress } from "./history.ts";

test("another view, of this table or another, clears the search and closes its settings", () => {
  assert.deepEqual(leaving("crm/deals", "all", "crm/deals", "pipe"), { clearSearch: true, closeSettings: true });
  assert.deepEqual(leaving("crm/deals", "all", "crm/companies", "all"), { clearSearch: true, closeSettings: true });
});

test("the view already on screen changes nothing", () => {
  assert.deepEqual(leaving("crm/deals", "all", "crm/deals", "all"), { clearSearch: false, closeSettings: false });
});

test("a view's address, with the open row's document when there is one", () => {
  assert.equal(viewAddress("crm/deals", "pipe"), "crm.table#table=deals&view=pipe");
  assert.equal(viewAddress("crm/deals", "pipe", "dl-1"), "crm.table#table=deals&row=dl-1&view=pipe");
  assert.equal(viewAddress("crm/deals", "pipe", ""), "crm.table#table=deals&view=pipe");
});
