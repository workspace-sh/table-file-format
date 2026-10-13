import { test } from "node:test";
import assert from "node:assert/strict";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";
import { stampEdits } from "@workspace.sh/table-core";
import { appendStoredHistory, bundleToArchive, fromBundle, keepArrivedHistories, openArchive, storedHistory, toBundle, withHistories } from "./index.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

test("a stored history goes out in the .table.zip and comes back into another store", async () => {
  const tables = fromBundle("projects", fixtures.projects!);
  const bundles = { projects: fixtures.projects!.meta };
  const here = memory();
  appendStoredHistory(here, "projects/projects", stampEdits([{ op: "set", row: "p1", field: "owner", from: "leslie", to: "sam" }]));
  const going = await withHistories(tables, (key) => storedHistory(here, key) || undefined);
  const bytes = await bundleToArchive("projects", toBundle(going, bundles, "projects"));
  const opened = await openArchive(bytes);
  const there = memory();
  const arrived = keepArrivedHistories(there, fromBundle(opened.key, opened.bundle));
  assert.equal(storedHistory(there, `${opened.key}/projects`), storedHistory(here, "projects/projects"));
  assert.equal((arrived[`${opened.key}/projects`] as { history?: string }).history, undefined);
});
