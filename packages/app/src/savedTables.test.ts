import { test } from "node:test";
import assert from "node:assert/strict";

import { clearSaved, loadSaved, save, savedFrom, STORAGE_KEY, withNewFixtures, type KeyValueStore } from "./savedTables.ts";
import type { ParsedTable } from "@workspace.sh/table-core";

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const table: ParsedTable = {
  path: "fixtures/projects.table",
  schema: { fields: [{ name: "title", type: "string" }] } as ParsedTable["schema"],
  rows: [{ id: "abc", title: "Edited" }],
  views: [{ id: "v1", name: "All", layout: "table" }] as ParsedTable["views"],
  meta: { title: "Projects" } as ParsedTable["meta"],
  bodies: { abc: "# Notes" },
};

const saved = { tables: { "projects/projects": table }, bundles: { projects: { title: "Projects" } } };

test("what is saved comes back as it was", () => {
  const store = memory();
  save(store, saved);
  assert.deepEqual(loadSaved(store), saved);
});

test("nothing saved, or no storage at all, means start from the fixtures", () => {
  assert.equal(loadSaved(memory()), null);
  assert.equal(loadSaved(null), null);
});

test("anything unreadable is discarded rather than trusted", () => {
  const bad = [
    "not json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ tables: { "projects/projects": { ...table, views: [] } }, bundles: saved.bundles }),
    JSON.stringify({ tables: { "projects/projects": { ...table, rows: "nope" } }, bundles: saved.bundles }),
    JSON.stringify({ tables: { "projects/projects": { ...table, schema: {} } }, bundles: saved.bundles }),
    JSON.stringify({ tables: { "projects/projects": { ...table, meta: undefined } }, bundles: saved.bundles }),
    // What demos before bundles saved (D37): discarded, not migrated.
    JSON.stringify({ projects: table }),
    // A table not under a bundle.
    JSON.stringify({ tables: { deals: table }, bundles: saved.bundles }),
  ];
  for (const raw of bad) {
    assert.equal(loadSaved(memory({ [STORAGE_KEY]: raw })), null, raw.slice(0, 40));
  }
});

test("a store that throws is treated as no store", () => {
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(loadSaved(throwing), null);
  save(throwing, saved);
  clearSaved(throwing);
});

test("reset forgets what was saved", () => {
  const store = memory();
  save(store, saved);
  clearSaved(store);
  assert.equal(loadSaved(store), null);
});

test("a fixture table added since the demo was saved appears, and edits stay", () => {
  const edited = { ...table, rows: [{ id: "abc", title: "Edited" }] };
  const fresh = { ...table, rows: [{ id: "abc", title: "Original" }] };
  const saved = {
    tables: { "home/budget": edited },
    bundles: { home: { format: "table" as const, title: "Home", tables: ["budget"] } },
    whole: true as const,
  };
  const fixtures = {
    tables: { "home/budget": fresh, "home/ledger": fresh, "shop/orders": fresh },
    bundles: {
      home: { format: "table" as const, title: "Home", tables: ["budget", "ledger"] },
      shop: { format: "table" as const, title: "Shop", tables: ["orders"] },
    },
  };
  const merged = withNewFixtures(saved, fixtures);
  assert.equal(merged.tables["home/budget"]!.rows[0]!.title, "Edited");
  assert.ok(merged.tables["home/ledger"]);
  assert.deepEqual(merged.bundles.home!.tables, ["budget", "ledger"]);
  assert.deepEqual(merged.bundles.shop!.tables, ["orders"]);
  // Nothing new: the very same object back.
  assert.equal(withNewFixtures(merged, fixtures), merged);
});

test("a new fixture table goes where the fixture puts it", () => {
  const saved = {
    tables: { "b/one": table, "b/three": table },
    bundles: { b: { format: "table" as const, tables: ["one", "three"] } },
    whole: true as const,
  };
  const fixtures = {
    tables: { "b/one": table, "b/two": table, "b/three": table },
    bundles: { b: { format: "table" as const, tables: ["one", "two", "three"] } },
  };
  assert.deepEqual(withNewFixtures(saved, fixtures).bundles.b!.tables, ["one", "two", "three"]);
});


// #592: an app follows the examples until one is edited.
const example: ParsedTable = { ...table, rows: [{ id: "abc", title: "As shipped" }] };
const examples = { tables: { "projects/projects": example }, bundles: { projects: { title: "Projects" } } };

test("an example left as it is isn't saved, so the next launch shows the example as it is then", () => {
  const kept = savedFrom(examples.tables, examples.bundles, [], examples);
  assert.deepEqual(kept, { tables: {}, bundles: {}, closed: [], whole: true });
  // Read back, a store with no tables in it is still a store (it may hold what was closed).
  const store = memory();
  save(store, kept);
  assert.deepEqual(loadSaved(store), kept);
  // The example changed since: the launch shows the new one.
  const changed = { ...examples, tables: { "projects/projects": { ...example, rows: [...example.rows, { id: "new", title: "Added" }] } } };
  assert.equal(withNewFixtures(kept, changed).tables["projects/projects"]!.rows.length, 2);
});

test("the same example read back from JSON is still the example, not an edit", () => {
  const copy = JSON.parse(JSON.stringify(examples)) as typeof examples;
  assert.deepEqual(savedFrom(copy.tables, copy.bundles, [], examples).tables, {});
});

test("an example edited is saved, and stays as edited whatever the example becomes", () => {
  const kept = savedFrom({ "projects/projects": table }, examples.bundles, [], examples);
  assert.deepEqual(Object.keys(kept.tables), ["projects/projects"]);
  assert.deepEqual(kept.bundles, examples.bundles);
  const changed = { ...examples, tables: { "projects/projects": { ...example, rows: [] } } };
  const loaded = withNewFixtures(kept, changed);
  assert.equal(loaded.tables["projects/projects"]!.rows[0]!.title, "Edited");
  assert.deepEqual(loaded.bundles.projects, examples.bundles.projects);
});

test("an edit undone back to the example is the example again", () => {
  const undone = { ...example, rows: [{ id: "abc", title: "As shipped" }] };
  assert.deepEqual(savedFrom({ "projects/projects": undone }, examples.bundles, [], examples).tables, {});
});

test("a file made here, and a renamed example, are saved; a saved table with no manifest anywhere is dropped", () => {
  const kept = savedFrom(
    { "projects/projects": example, "notes/notes": table },
    { projects: { title: "Renamed" }, notes: { title: "Notes" } },
    [],
    examples,
  );
  assert.deepEqual(Object.keys(kept.tables), ["projects/projects", "notes/notes"]);
  assert.deepEqual(kept.bundles, { projects: { title: "Renamed" }, notes: { title: "Notes" } });
  const orphan = withNewFixtures({ tables: { "gone/gone": table }, bundles: {}, whole: true }, examples);
  assert.deepEqual(Object.keys(orphan.tables), ["projects/projects"]);
});

test("an example closed stays closed, with nothing of it saved", () => {
  const kept = savedFrom({}, {}, ["projects"], examples);
  const store = memory();
  save(store, kept);
  const loaded = withNewFixtures(loadSaved(store)!, examples);
  assert.deepEqual(loaded.tables, {});
  assert.deepEqual(loaded.closed, ["projects"]);
});

// An example's tables link by row id, so one is never kept from another version of the example than the rest.
const shop = {
  tables: { "shop/orders": { ...table, rows: [{ id: "o1", customer: "c-new" }] }, "shop/customers": { ...table, rows: [{ id: "c-new" }] } },
  bundles: { shop: { format: "table" as const, tables: ["orders", "customers"] } },
};

test("an example edited is kept whole: the tables left as they are with it", () => {
  const orders = { ...shop.tables["shop/orders"], rows: [{ id: "o1", customer: "c-new", note: "edited" }] };
  const kept = savedFrom({ ...shop.tables, "shop/orders": orders }, shop.bundles, [], shop);
  assert.deepEqual(Object.keys(kept.tables).sort(), ["shop/customers", "shop/orders"]);
  // The example's ids change since: the saved file still links to its own customers.
  const next = { ...shop, tables: { "shop/orders": shop.tables["shop/orders"], "shop/customers": { ...table, rows: [{ id: "c-newer" }] } } };
  const loaded = withNewFixtures(loadSavedFrom(kept), next);
  assert.equal(loaded.tables["shop/customers"]!.rows[0]!.id, "c-new");
});

test("an example saved table by table, before files were kept whole, comes back as the example", () => {
  const old = { tables: { "shop/orders": { ...table, rows: [{ id: "o1", customer: "c-old" }] }, "notes/notes": table }, bundles: { notes: { title: "Notes" } } };
  const loaded = withNewFixtures(loadSavedFrom(old), shop);
  assert.equal(loaded.tables["shop/orders"]!.rows[0]!.customer, "c-new");
  // A file made here is kept.
  assert.ok(loaded.tables["notes/notes"]);
  assert.equal(loaded.whole, true);
});

function loadSavedFrom(value: object) {
  const store = memory();
  store.setItem(STORAGE_KEY, JSON.stringify(value));
  return loadSaved(store)!;
}
