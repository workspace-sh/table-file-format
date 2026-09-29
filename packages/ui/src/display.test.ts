import { test } from "node:test";
import assert from "node:assert/strict";

import { FormulaError, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { columnWidths, describeCell, relationLabel, totalFor } from "./display.ts";

const plain = {};
const status: Field = {
  name: "status",
  type: "string",
  constraints: { enum: [{ value: "done", label: "Done", color: "green" }, "todo"] },
};
const tags: Field = { name: "tags", type: "array", constraints: { enum: [{ value: "a", label: "Alpha", color: "red" }] } };
const owner: Field = { name: "owner", type: "string", relation: { table: "people", field: "id" } };
const people = {
  schema: { fields: [{ name: "name", type: "string" }] },
  rows: [{ id: "p1", name: "Ada" }],
  views: [],
} as unknown as ParsedTable;

test("a relation shows the related row's title, and a missing row is broken", () => {
  assert.deepEqual(describeCell(owner, "p1", plain, { people }), {
    kind: "relations",
    links: [{ id: "p1", label: "Ada", address: "people#row=p1" }],
  });
  assert.equal(relationLabel(owner.relation!, "gone", { people }), null);
  assert.equal(relationLabel(owner.relation!, "p1", undefined), null);
});

test("a choice is a pill with its label and colour, a list is one pill each", () => {
  assert.deepEqual(describeCell(status, "done", plain), { kind: "pills", pills: [{ value: "done", label: "Done", color: "green" }] });
  assert.deepEqual(describeCell(status, "todo", plain), { kind: "pills", pills: [{ value: "todo", label: "todo" }] });
  assert.deepEqual(describeCell(tags, ["a", "b"], plain), {
    kind: "pills",
    pills: [{ value: "a", label: "Alpha", color: "red" }, { value: "b", label: "b" }],
  });
  assert.deepEqual(describeCell(tags, [], plain), { kind: "text", text: "—", oneToken: false });
});

test("a failed formula shows its code", () => {
  assert.deepEqual(describeCell(undefined, new FormulaError("#DIV/0!", "divided by zero"), plain), { kind: "error", code: "#DIV/0!" });
});

test("links, attachments, formats and plain values", () => {
  const email: Field = { name: "e", type: "string", format: "email" };
  const phone: Field = { name: "p", type: "string", format: "phone" };
  const site: Field = { name: "u", type: "string", format: "url" };
  assert.deepEqual(describeCell(email, "a@b.c", plain), { kind: "link", text: "a@b.c", href: "mailto:a@b.c", external: false });
  assert.deepEqual(describeCell(phone, "+44 (20) 7946", plain), { kind: "link", text: "+44 (20) 7946", href: "tel:+44207946", external: false });
  assert.equal((describeCell(site, "https://x.y", plain) as { external: boolean }).external, true);
  const file: Field = { name: "f", type: "string", attachment: true } as Field;
  assert.deepEqual(describeCell(file, "a.png", plain), { kind: "attachment", fileName: "a.png" });
  const price: Field = { name: "n", type: "number", format: "currency:USD" };
  assert.deepEqual(describeCell(price, 18, { locale: "en-US" }), { kind: "text", text: "$18.00", oneToken: true });
  assert.deepEqual(describeCell({ name: "t", type: "string" }, "", plain), { kind: "text", text: "—", oneToken: false });
  assert.deepEqual(describeCell({ name: "b", type: "boolean" }, true, plain), { kind: "text", text: "true", oneToken: false });
});

test("an average total is rounded to cents; counts are not numeric", () => {
  const rows = [{ id: "1", n: 1 }, { id: "2", n: 2 }, { id: "3", n: 2 }];
  assert.deepEqual(totalFor(rows, "n", "average"), { value: 1.67, numeric: true });
  assert.deepEqual(totalFor(rows, "n", "count"), { value: 3, numeric: false });
});

test("columns fill the table exactly, resized ones keep their width, and narrow tables scroll", () => {
  const w = columnWidths(["a", "b", "c"], { c: 100 }, 503, 2);
  assert.deepEqual([w("a"), w("b"), w("c")], [201, 200, 100]);
  assert.equal(w("a") + w("b") + w("c") + 2, 503);
  const narrow = columnWidths(["a", "b"], { b: 10 }, 200, 2);
  assert.deepEqual([narrow("a"), narrow("b")], [180, 60]);
  assert.equal(columnWidths(["a"], {}, 0, 2)("a"), 180);
});
