import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceOf } from "./source.js";
import { readBundle } from "./io.js";
import { writeBundleTo } from "./io.js";
import { nodeFs } from "./node-fs.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE = { uri: "https://example.org/exports/sales.csv", format: "text/csv", retrieved_at: "2026-10-27T10:00:00Z" };

test("a well-formed source is read as written", () => {
  assert.deepEqual(sourceOf({ source: SOURCE }), SOURCE);
  assert.deepEqual(sourceOf({ source: { uri: "file:///home/a/sales.csv" } }), { uri: "file:///home/a/sales.csv" });
});

test("a source that isn't an object, or has nothing to say, reads as none", () => {
  for (const source of [undefined, null, "https://example.org/a.csv", ["https://example.org/a.csv"], 3, {}, { uri: "" }, { uri: 1 }]) {
    assert.equal(sourceOf({ source } as never), undefined, JSON.stringify(source));
  }
  assert.equal(sourceOf(undefined), undefined);
});

test("members that aren't strings are dropped, the rest kept", () => {
  assert.deepEqual(sourceOf({ source: { uri: "https://example.org/a.csv", format: 7, retrieved_at: null } } as never), {
    uri: "https://example.org/a.csv",
  });
});

test("a source survives a read and a write, in the bundle's meta.json and a table's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-source-"));
  try {
    const path = join(dir, "sales.table");
    await writeBundleTo(nodeFs, path, {
      meta: { title: "Sales", source: SOURCE },
      tables: {
        sales: {
          schema: { fields: [{ name: "region", type: "string" }] },
          rows: [{ id: "r1", region: "North" }],
          views: [],
          meta: { source: { uri: "https://example.org/exports/sales.csv", format: "text/csv" } },
        },
      },
    } as never);
    const manifest = JSON.parse(readFileSync(join(path, "meta.json"), "utf8"));
    assert.deepEqual(manifest.source, SOURCE);
    const bundle = await readBundle(nodeFs, path);
    assert.deepEqual(sourceOf(bundle.meta), SOURCE);
    assert.deepEqual(sourceOf(bundle.tables["sales"]?.meta), { uri: "https://example.org/exports/sales.csv", format: "text/csv" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
