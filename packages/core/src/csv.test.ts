import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV, fromCSV, csvExportWarnings, delimitedCells, tableFromCSV } from "./csv.js";
import { derivedFieldId } from "./fieldIds.js";
import type { ParsedTable, Row, TableSchema } from "./types.js";

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

// A spreadsheet someone already has

const keyOf = (heading: string, taken: ReadonlySet<string>) => {
  const base = heading.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
};

test("a spreadsheet's headings become fields, titled as written and keyed by the app's rule; its lines become rows", () => {
  const csv = "First Name,Close Date,Amount,Paid,Notes\nAda,2026-03-01,1200.5,true,\"Said \"\"yes\"\", twice\"\nGrace,2026-04-15,80,false,\n";
  const { schema, rows, extraCells } = tableFromCSV(csv, { keyOf });
  // Each field's id comes from its name (D62): the same sheet read twice gives the same ids.
  for (const f of schema.fields) assert.equal(f.id, derivedFieldId(f.name));
  assert.deepEqual(schema.fields.map(({ id: _, ...f }) => f), [
    { name: "first_name", title: "First Name", type: "string" },
    { name: "close_date", title: "Close Date", type: "date" },
    { name: "amount", title: "Amount", type: "number" },
    { name: "paid", title: "Paid", type: "boolean" },
    { name: "notes", title: "Notes", type: "string" },
  ]);
  assert.equal(rows.length, 2);
  const [ada, grace] = rows;
  assert.deepEqual({ ...ada, id: "" }, { id: "", first_name: "Ada", close_date: "2026-03-01", amount: 1200.5, paid: true, notes: 'Said "yes", twice' });
  // An empty cell is no value.
  assert.equal("notes" in grace!, false);
  assert.equal(grace!.amount, 80);
  // Each row has an id of its own.
  assert.ok(ada!.id.length > 0 && ada!.id !== grace!.id);
  assert.equal(extraCells, 0);
});

test("without an app's rule a heading is its field's name, numbered when it repeats; an empty one is Column N", () => {
  const { schema, rows } = tableFromCSV("Name,,Name,id\nA,b,c,1\nD,e,f,1\n");
  assert.deepEqual(
    schema.fields.map((f) => [f.name, f.title]),
    [
      ["Name", undefined],
      ["Column 2", undefined],
      ["Name 2", "Name"],
      // Two rows share an id, so it can't be theirs: it is a column like any other, under another key.
      ["id 2", "id"],
    ],
  );
  assert.deepEqual(
    rows.map((r) => [r.Name, r["Column 2"], r["Name 2"], r["id 2"]]),
    [
      ["A", "b", "c", 1],
      ["D", "e", "f", 1],
    ],
  );
  assert.notEqual(rows[0]!.id, rows[1]!.id);
});

test("a column headed id gives the rows their ids when every row has its own", () => {
  const { schema, rows } = tableFromCSV("id,title\nr1,One\nr2,Two\n");
  assert.deepEqual(schema.fields, [{ id: derivedFieldId("title"), name: "title", type: "string" }]);
  assert.deepEqual(rows, [
    { id: "r1", title: "One" },
    { id: "r2", title: "Two" },
  ]);
  // One row without: none of them are taken as ids.
  const mixed = tableFromCSV("id,title\nr1,One\n,Two\n");
  assert.deepEqual(
    mixed.schema.fields.map((f) => f.title ?? f.name),
    ["id", "title"],
  );
});

test("digits that aren't a quantity stay as written: leading zeros, a plus, more digits than a number keeps", () => {
  const { schema, rows } = tableFromCSV("zip,phone,card,qty,price\n01234,+442079460101,4111111111111111,3,9.50\n90210,+15551234567,5500000000000004,12,0.5\n");
  assert.deepEqual(
    schema.fields.map((f) => [f.name, f.type]),
    [
      ["zip", "string"],
      ["phone", "string"],
      ["card", "string"],
      ["qty", "integer"],
      ["price", "number"],
    ],
  );
  assert.deepEqual(rows.map((r) => [r.zip, r.phone, r.card, r.qty, r.price]), [
    ["01234", "+442079460101", "4111111111111111", 3, 9.5],
    ["90210", "+15551234567", "5500000000000004", 12, 0.5],
  ]);
});

test("only ISO dates are dates; other ways of writing a day stay text for whoever knows what they mean", () => {
  const { schema } = tableFromCSV("iso,when,uk,mixed\n2026-01-02,2026-01-02T09:30:00Z,03/04/2025,2026-01-02\n2026-12-31,2026-12-31T17:00,25/12/2025,soon\n");
  assert.deepEqual(
    schema.fields.map((f) => f.type),
    ["date", "datetime", "string", "string"],
  );
});

test("tabs, semicolons and pipes separate cells too: the file's own separator is found", () => {
  assert.deepEqual(delimitedCells("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(delimitedCells("a;b;c\n1,5;2;3\n"), [["a", "b", "c"], ["1,5", "2", "3"]]);
  assert.deepEqual(delimitedCells("a\tb\n1\tone, two\n"), [["a", "b"], ["1", "one, two"]]);
  assert.deepEqual(delimitedCells("a|b\n1|2\n"), [["a", "b"], ["1", "2"]]);
  // A separator inside quotes is part of the cell.
  assert.deepEqual(delimitedCells('"a;b",c\n"x;y",z\n'), [["a;b", "c"], ["x;y", "z"]]);
  const semi = tableFromCSV("Name;Amount\nAda;3\nGrace;4\n");
  assert.deepEqual(semi.rows.map((r) => [r.Name, r.Amount]), [["Ada", 3], ["Grace", 4]]);
  const tabs = tableFromCSV("Name\tNote\nAda\tone, two\nGrace\tthree\n");
  assert.deepEqual(tabs.rows.map((r) => [r.Name, r.Note]), [["Ada", "one, two"], ["Grace", "three"]]);
  // A cell that runs over lines, and a quote inside one.
  assert.deepEqual(delimitedCells('note,n\n"line one\nline two",1\n"say ""hi""",2\n'), [["note", "n"], ["line one\nline two", "1"], ['say "hi"', "2"]]);
});

test("empty lines are no rows, a BOM is no part of a heading, and cells past the headings are counted, not kept", () => {
  const { schema, rows, extraCells } = tableFromCSV("\ufeffName,Qty\r\n\r\nAda,1,stray,\r\n,,\r\nGrace,2\r\n");
  assert.deepEqual(schema.fields.map((f) => f.name), ["Name", "Qty"]);
  assert.deepEqual(rows.map((r) => [r.Name, r.Qty]), [["Ada", 1], ["Grace", 2]]);
  assert.equal(extraCells, 1);
  assert.deepEqual(tableFromCSV(""), { schema: { fields: [] }, rows: [], extraCells: 0 });
  // Headings and no rows: the fields are there, as text.
  assert.deepEqual(tableFromCSV("A,B\n").schema.fields.map((f) => f.type), ["string", "string"]);
});


test("a sheet without a header row: every line a row, fields named for their columns (D59)", async () => {
  const { tableFromCSV } = await import("./csv.js");
  const t = tableFromCSV("Apples,3\nBread,4,extra\n", { header: false });
  assert.deepEqual(t.schema.fields.map((f) => [f.name, f.type]), [["A", "string"], ["B", "integer"], ["C", "string"]]);
  assert.deepEqual(t.rows.map(({ id: _id, ...r }) => r), [{ A: "Apples", B: 3 }, { A: "Bread", B: 4, C: "extra" }]);
  // With a header, as before.
  assert.equal(tableFromCSV("item,qty\nApples,3\n").rows.length, 1);
});

test("a first line of data, not headings, is told apart (D59)", async () => {
  const { firstLineIsData } = await import("./csv.js");
  assert.equal(firstLineIsData("Apples,3,2026-01-02\nBread,4,2026-02-03\n"), true);
  assert.equal(firstLineIsData("item,qty,when\nApples,3,2026-01-02\n"), false);
  // Words only: nothing to tell by, so a header, as before.
  assert.equal(firstLineIsData("name,city\nAda,Paris\n"), false);
  assert.equal(firstLineIsData("one line\n"), false);
});

test("a column mostly of numbers, with words among them, is `any`: each kept as what it is (D56)", async () => {
  const { tableFromCSV } = await import("./csv.js");
  const t = tableFromCSV("item,qty\nApples,3\nBread,n/a\nCheese,5\n");
  assert.equal(t.schema.fields.find((f) => f.name === "qty")!.type, "any");
  assert.deepEqual(t.rows.map((r) => r.qty), [3, "n/a", 5]);
  // All words, or all numbers: as before.
  assert.equal(tableFromCSV("a\nx\ny\n").schema.fields[0]!.type, "string");
  assert.equal(tableFromCSV("a\n1\n2\n").schema.fields[0]!.type, "integer");
});
