import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedTable } from "@workspace.sh/table-core";

import { attachedNames, droppedAttachments } from "./droppedAttachments.ts";

const table = (rows: Record<string, unknown>[], indexed = false): ParsedTable =>
  ({
    schema: { fields: [{ name: "title", type: "string" }, { name: "poster", type: "string", attachment: true }] },
    rows,
    views: [],
    meta: {},
    ...(indexed ? { indexed: {} } : {}),
  }) as unknown as ParsedTable;

test("only attachment fields' filenames are named", () => {
  assert.deepEqual([...attachedNames(table([{ title: "a.png", poster: "p.jpg" }, { title: "b", poster: "" }, { title: "c" }]))!], ["p.jpg"]);
  assert.equal(attachedNames(table([], true)), null);
});

test("a file taken out or replaced is dropped; one still named, or never touched, is kept", () => {
  const before = attachedNames(table([{ poster: "old.jpg" }, { poster: "kept.jpg" }, { poster: "shared.jpg" }, { poster: "shared.jpg" }]));
  const after = attachedNames(table([{ poster: "new.jpg" }, { poster: "kept.jpg" }, { poster: "shared.jpg" }, {}]));
  assert.deepEqual(droppedAttachments(before, ["new.jpg", "tried.jpg"], after), ["old.jpg", "tried.jpg"]);
});

test("nothing is dropped when the rows aren't all known", () => {
  assert.deepEqual(droppedAttachments(null, ["a.jpg"], new Set()), []);
  assert.deepEqual(droppedAttachments(new Set(["a.jpg"]), [], null), []);
});
