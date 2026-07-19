import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV, fromCSV, csvExportWarnings } from "./csv";
import type { ParsedTable, Row, TableSchema } from "./types";

const schema: TableSchema = {
  fields: [
    { name: "title", type: "string" },
    { name: "count", type: "integer" },
    { name: "ratio", type: "number" },
    { name: "active", type: "boolean" },
    { name: "tags", type: "array" },
  ],
};

const rows: Row[] = [
  { id: "r1", title: "Alpha", count: 3, ratio: 1.5, active: true, tags: ["a", "b"] },
  { id: "r2", title: "Beta", count: 0, ratio: 2, active: false, tags: [] },
];

test("toCSV emits an id column first, header in schema order", () => {
  const csv = toCSV({ schema, rows });
  const [header] = csv.split("\n");
  assert.equal(header, "id,title,count,ratio,active,tags");
  assert.ok(csv.endsWith("\n"), "trailing newline");
});

test("round-trip preserves structural values with schema", () => {
  const csv = toCSV({ schema, rows });
  const back = fromCSV(csv, schema);
  assert.deepEqual(back.rows, rows);
});

test("toCSV honours the fields option (subset + order)", () => {
  const csv = toCSV({ schema, rows }, { fields: ["count", "title"] });
  assert.equal(csv.split("\n")[0], "id,count,title");
});

test("RFC 4180 quoting: commas, quotes, newlines round-trip", () => {
  const tricky: Row[] = [
    { id: "r1", title: 'has, comma' },
    { id: "r2", title: 'has "quotes"' },
    { id: "r3", title: "has\nnewline" },
    { id: "r4", title: "  leading-space" },
  ];
  const s: TableSchema = { fields: [{ name: "title", type: "string" }] };
  const csv = toCSV({ schema: s, rows: tricky });
  // embedded field is quoted
  assert.match(csv, /"has, comma"/);
  assert.match(csv, /"has ""quotes"""/);
  const back = fromCSV(csv, s);
  assert.deepEqual(back.rows, tricky);
});

test("empty cells become omitted keys, not empty strings", () => {
  const csv = "id,title,count\nr1,Alpha,\nr2,,5\n";
  const back = fromCSV(csv, schema);
  assert.deepEqual(back.rows[0], { id: "r1", title: "Alpha" });
  assert.deepEqual(back.rows[1], { id: "r2", count: 5 });
});

test("fromCSV mints ids when no id column is present", () => {
  const csv = "title,count\nAlpha,3\nBeta,4\n";
  const back = fromCSV(csv, schema);
  assert.equal(back.rows.length, 2);
  assert.ok(back.rows.every((r) => typeof r.id === "string" && r.id.length > 0));
  assert.notEqual(back.rows[0]!.id, back.rows[1]!.id);
});

test("fromCSV strips a leading BOM", () => {
  const csv = "﻿id,title\nr1,Alpha\n";
  const back = fromCSV(csv, schema);
  assert.equal(back.rows[0]!.id, "r1");
  assert.equal(back.rows[0]!.title, "Alpha");
});

test("fromCSV handles CRLF line endings", () => {
  const csv = "id,title\r\nr1,Alpha\r\nr2,Beta\r\n";
  const back = fromCSV(csv, schema);
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[1]!.title, "Beta");
});

test("schema-less import infers column types", () => {
  const csv = "id,name,qty,rate,flag\nr1,Alpha,3,1.5,true\nr2,Beta,4,2.0,false\n";
  const { schema: inferred } = fromCSV(csv);
  const byName = new Map(inferred.fields.map((f) => [f.name, f.type]));
  assert.equal(byName.get("name"), "string");
  assert.equal(byName.get("qty"), "integer");
  assert.equal(byName.get("rate"), "number");
  assert.equal(byName.get("flag"), "boolean");
});

test("csvExportWarnings flags relations, attachments, bodies", () => {
  const lossy: ParsedTable = {
    path: "x",
    meta: {},
    views: [],
    schema: {
      fields: [
        { name: "project", type: "string", relation: { table: "projects", field: "id" } },
        {
          name: "tags",
          type: "string",
          relation: { table: "tags", field: "id", cardinality: "many" },
        },
        { name: "avatar", type: "string", attachment: true },
      ],
    },
    rows: [{ id: "r1" }],
    bodies: { r1: "# body" },
  };
  const warnings = csvExportWarnings(lossy);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((w) => w.includes("project") && w.includes("relation")));
  assert.ok(warnings.some((w) => w.includes("ids (joined)")));
  assert.ok(warnings.some((w) => w.includes("avatar") && w.includes("attachment")));
  assert.ok(warnings.some((w) => w.includes("markdown bodies")));
});

test("empty CSV yields no rows", () => {
  assert.deepEqual(fromCSV("").rows, []);
  assert.deepEqual(fromCSV("\n").rows, []);
});
