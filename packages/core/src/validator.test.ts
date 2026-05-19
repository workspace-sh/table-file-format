import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, validateBodies } from "./validator";
import type { Row, TableSchema } from "./types";

const schema: TableSchema = {
  fields: [
    { name: "title", type: "string", constraints: { required: true } },
    { name: "status", type: "string", constraints: { enum: ["a", "b"] } },
    { name: "n", type: "integer", constraints: { minimum: 0, maximum: 10 } },
  ],
  primaryKey: ["title"],
};

test("validate accepts a clean table", () => {
  const rows: Row[] = [
    { id: "r1", title: "x", status: "a", n: 5 },
    { id: "r2", title: "y", status: "b", n: 0 },
  ];
  assert.equal(validate(schema, rows).length, 0);
});

test("validate flags rows missing system id", () => {
  const rows = [{ id: "", title: "x", status: "a", n: 1 } as unknown as Row];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.message.includes("system id")));
});

test("validate flags duplicate system id", () => {
  const rows: Row[] = [
    { id: "r1", title: "x", status: "a", n: 1 },
    { id: "r1", title: "y", status: "b", n: 2 },
  ];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.message.includes("duplicate")));
});

test("validate flags enum violation", () => {
  const rows: Row[] = [{ id: "r1", title: "x", status: "z", n: 1 }];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.field === "status" && e.message.includes("enum")));
});

test("validate flags type mismatch", () => {
  const rows: Row[] = [{ id: "r1", title: "x", status: "a", n: "five" }];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.field === "n" && e.message.includes("type")));
});

test("validate flags primary-key collision", () => {
  const rows: Row[] = [
    { id: "r1", title: "x", status: "a", n: 1 },
    { id: "r2", title: "x", status: "b", n: 2 },
  ];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.message.includes("primary key collision")));
});

test("validate flags missing required field", () => {
  const rows: Row[] = [{ id: "r1", title: "", status: "a", n: 1 }];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.field === "title" && e.message.includes("required")));
});

test("validate flags out-of-range numbers", () => {
  const rows: Row[] = [{ id: "r1", title: "x", status: "a", n: 99 }];
  const errors = validate(schema, rows);
  assert.ok(errors.some((e) => e.field === "n" && e.message.includes("maximum")));
});

test("validateBodies flags orphan body files", () => {
  const rows: Row[] = [{ id: "r1", title: "x", status: "a", n: 1 }];
  const bodies = { r1: "ok", r2: "orphan" };
  const errors = validateBodies(rows, bodies);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.rowId, "r2");
  assert.match(errors[0]!.message, /orphan/);
});

test("validateBodies returns no errors when bodies is undefined", () => {
  const rows: Row[] = [{ id: "r1", title: "x", status: "a", n: 1 }];
  assert.equal(validateBodies(rows, undefined).length, 0);
});

test("validateBodies passes when every body has a matching row", () => {
  const rows: Row[] = [
    { id: "r1", title: "x", status: "a", n: 1 },
    { id: "r2", title: "y", status: "b", n: 2 },
  ];
  const errors = validateBodies(rows, { r1: "a", r2: "b" });
  assert.equal(errors.length, 0);
});
