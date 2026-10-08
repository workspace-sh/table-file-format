import { test } from "node:test";
import assert from "node:assert/strict";

import { findNode, initiallyOpen, symbolFor, visibleRows } from "./tree.ts";
import type { FileNode } from "./types.ts";

const tree: FileNode[] = [
  {
    id: "crm",
    name: "crm.table",
    open: true,
    children: [
      { id: "crm/meta", name: "meta.json" },
      {
        id: "crm/tables/deals",
        name: "deals",
        children: [
          { id: "crm/tables/deals/rows", name: "rows.ndjson", note: "8 rows" },
          { id: "crm/tables/deals/attachments", name: "attachments", children: [{ id: "crm/a/logo", name: "logo.png", opens: "image" }] },
        ],
      },
    ],
  },
];

test("only folders marked open start open", () => {
  assert.deepEqual([...initiallyOpen(tree)], ["crm"]);
});

test("a closed folder's entries don't show; an open one's do, a level deeper", () => {
  const shown = visibleRows(tree, new Set(["crm"]));
  assert.deepEqual(
    shown.map((r) => `${r.depth}:${r.node.name}${r.folder ? (r.expanded ? "/-" : "/+") : ""}`),
    ["0:crm.table/-", "1:meta.json", "1:deals/+"],
  );
  const deeper = visibleRows(tree, new Set(["crm", "crm/tables/deals"]));
  assert.deepEqual(deeper.map((r) => r.node.name), ["crm.table", "meta.json", "deals", "rows.ndjson", "attachments"]);
});

test("a node is found anywhere in the tree", () => {
  assert.equal(findNode(tree, "crm/a/logo")?.name, "logo.png");
  assert.equal(findNode(tree, "nowhere"), undefined);
});

test("each kind of file has its symbol", () => {
  assert.equal(symbolFor({ id: "a", name: "notes.md" }), "doc.richtext");
  assert.equal(symbolFor({ id: "b", name: "rows.ndjson" }), "curlybraces");
  assert.equal(symbolFor({ id: "c", name: "logo.PNG" }), "photo");
  assert.equal(symbolFor({ id: "d", name: "readme.txt" }), "doc.text");
  assert.equal(symbolFor({ id: "e", name: "data.bin" }), "doc");
  assert.equal(symbolFor({ id: "f", name: "deals", children: [] }), "folder");
  assert.equal(symbolFor({ id: "f", name: "deals", children: [] }, true), "folder.fill");
});
