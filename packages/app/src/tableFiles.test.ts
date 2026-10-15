import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";

import { newBundle, newTable } from "@workspace.sh/table-core";
import type { ParsedBundle } from "@workspace.sh/table-core";
import { singleFileName, bundleToArchive, importSkippedText, isSpreadsheetFile, openArchive, openFailedText, openSpreadsheet, spreadsheetText, type OpenedBundle, exportFailedText } from "./tableFiles.ts";

const NOW = new Date("2026-09-25T20:00:00Z");

function sample(): ParsedBundle {
  const b = newBundle("Reading list", "reading-list.table", "books", NOW);
  const books = b.tables.books!;
  const authors = newTable("Authors", "reading-list.table/tables/authors", NOW);
  return {
    ...b,
    meta: { ...b.meta, tables: ["books", "authors"] },
    tables: {
      books: {
        ...books,
        rows: [
          { id: "a1", title: "The Dispossessed" },
          { id: "b2", title: "Braiding Sweetgrass" },
        ],
        // Bodies end with a newline, as the writer writes them.
        bodies: { a1: "# Notes\n\nAnarres.\n" },
      },
      authors: { ...authors, rows: [{ id: "u1", title: "Ursula K. Le Guin" }] },
    },
  };
}

test("a bundle downloads as a single <key>.table (D50) and opens back as it was, every table (D37)", async () => {
  const b = sample();
  assert.equal(singleFileName("reading-list"), "reading-list.table");
  const opened = await openArchive(await bundleToArchive("reading-list", b), ["projects"]);
  assert.equal(opened.key, "reading-list");
  assert.deepEqual(opened.bundle.meta.tables, ["books", "authors"]);
  for (const name of ["books", "authors"]) {
    assert.deepEqual(opened.bundle.tables[name]!.rows, b.tables[name]!.rows, name);
    assert.deepEqual(opened.bundle.tables[name]!.schema, b.tables[name]!.schema, name);
    assert.deepEqual(opened.bundle.tables[name]!.views, b.tables[name]!.views, name);
  }
  assert.deepEqual(opened.bundle.tables.books!.bodies, b.tables.books!.bodies);
  assert.equal(opened.bundle.meta.title, "Reading list");
  assert.deepEqual(opened.skipped, []);
});

test("opening one whose name is taken keeps both", async () => {
  const opened = await openArchive(await bundleToArchive("reading-list", sample()), ["reading-list"]);
  assert.equal(opened.key, "reading-list-2");
});

test("what the reader skipped is said, per table, and the rest still opens (D25)", async () => {
  const files = unzipSync(await bundleToArchive("reading-list", sample()));
  const rows = "reading-list.table/tables/books/rows/0001.ndjson";
  files[rows] = strToU8(`{"id":"a1","title":"Kept"}\n<<<<<<< HEAD\n{"title":"no id"}\n`);
  const opened = await openArchive(zipSync(files), []);
  assert.deepEqual(opened.bundle.tables.books!.rows, [{ id: "a1", title: "Kept" }]);
  assert.equal(opened.skipped.length, 2);
  assert.match(opened.skipped[0]!, /^books: rows\/0001\.ndjson: line 2 /);
  assert.match(opened.skipped[1]!, /^books: rows\/0001\.ndjson: line 3 /);
  assert.equal(opened.bundle.tables.books!.diagnostics, undefined);
});

test("a file with no table in it is refused, not half-opened", async () => {
  await assert.rejects(openArchive(strToU8("not a zip"), []));
  const files = unzipSync(await bundleToArchive("reading-list", sample()));
  for (const name of Object.keys(files)) if (name.includes("/schema.json")) delete files[name];
  await assert.rejects(openArchive(zipSync(files), []), /isn't a table/);
});

test("what a file was read with is never written back", async () => {
  const b = sample();
  const withNotes = { ...b, tables: { ...b.tables, books: { ...b.tables.books!, diagnostics: [{ rowIndex: 0, message: "old" }] } } };
  const opened = await openArchive(await bundleToArchive("reading-list", withNotes), []);
  assert.deepEqual(opened.skipped, []);
});

test("what opening says: the skipped lines under a count, nothing when it read cleanly", () => {
  const opened = (skipped: string[]): OpenedBundle => ({ key: "crm", bundle: { path: "crm", meta: { title: "CRM" }, tables: {} }, skipped });
  assert.equal(importSkippedText(opened([])), null);
  assert.deepEqual(importSkippedText(opened(["deals: rows/0001.ndjson: line 3 isn't JSON"])), {
    heading: `Opened "CRM", but skipped 1 thing it couldn't read:`,
    body: "deals: rows/0001.ndjson: line 3 isn't JSON",
  });
  assert.match(importSkippedText(opened(["a", "b"]))!.heading, /skipped 2 things/);
  assert.equal(openFailedText("x.zip", new Error("not a zip")), "Couldn't open x.zip: not a zip");
});


test("an export that fails says which file and why", () => {
  assert.equal(exportFailedText("crm.table", new Error("disk full")), "Couldn't export crm.table: disk full");
  assert.equal(exportFailedText("crm.table.zip", "no"), "Couldn't export crm.table.zip: no");
});

// A spreadsheet someone already has

test("a spreadsheet opens as a new .table file: one table named after the file, a field a heading, a row a line", async () => {
  const csv = "Client Name,Due Date,Amount (GBP),Paid\nAda & Co,2026-11-01,1200.50,true\nGrace Ltd,2026-12-15,80,false\n";
  const opened = openSpreadsheet(csv, "Q4_invoices-2026.csv", [], new Date("2026-10-14T10:00:00Z"));
  assert.equal(opened.key, "q4-invoices-2026");
  assert.equal(opened.bundle.meta.title, "Q4 invoices 2026");
  assert.deepEqual(Object.keys(opened.bundle.tables), ["q4-invoices-2026"]);
  const table = opened.bundle.tables["q4-invoices-2026"]!;
  assert.equal(table.meta.title, "Q4 invoices 2026");
  // Keys as the app's own new fields get them, so formulas read plainly; the headings stay as titles.
  assert.deepEqual(table.schema.fields, [
    { name: "client_name", title: "Client Name", type: "string" },
    { name: "due_date", title: "Due Date", type: "date" },
    { name: "amount_gbp", title: "Amount (GBP)", type: "number" },
    { name: "paid", title: "Paid", type: "boolean" },
  ]);
  assert.deepEqual(
    table.rows.map(({ id: _id, ...rest }) => rest),
    [
      { client_name: "Ada & Co", due_date: "2026-11-01", amount_gbp: 1200.5, paid: true },
      { client_name: "Grace Ltd", due_date: "2026-12-15", amount_gbp: 80, paid: false },
    ],
  );
  // One view of every row, to start from.
  assert.deepEqual(table.views.map((v) => [v.name, v.layout]), [["All", "table"]]);
  assert.deepEqual(opened.skipped, []);
  // It is a real .table: out as an archive and back, it is the same.
  const back = await openArchive(await bundleToArchive(opened.key, opened.bundle), []);
  assert.deepEqual(back.bundle.tables["q4-invoices-2026"]!.rows, table.rows);
  assert.deepEqual(back.bundle.tables["q4-invoices-2026"]!.schema.fields, table.schema.fields);
});

test("a spreadsheet whose name is taken is kept apart; one with nothing in it is refused; what was left out is said", () => {
  assert.equal(openSpreadsheet("a,b\n1,2\n", "Sales.csv", ["sales"]).key, "sales-2");
  assert.equal(openSpreadsheet("a,b\n1,2\n", "/home/me/My Files/Sales.tsv", []).bundle.meta.title, "Sales");
  assert.equal(openSpreadsheet("a,b\n1,2\n", ".csv", []).bundle.meta.title, "Table");
  assert.throws(() => openSpreadsheet("", "empty.csv", []), /nothing in it/);
  assert.throws(() => openSpreadsheet("\n\n", "empty.csv", []), /nothing in it/);
  assert.deepEqual(openSpreadsheet("a,b\n1,2,3\n", "x.csv", []).skipped, ["1 cell was past the last heading, and left out."]);
  assert.deepEqual(openSpreadsheet("a\n1,2,3\n4,5,6\n", "x.csv", []).skipped, ["4 cells were past the last heading, and left out."]);
  // Headings and no rows is a table with no rows.
  assert.deepEqual(openSpreadsheet("Name,Qty\n", "x.csv", []).bundle.tables.x!.rows, []);
});

test("a spreadsheet's bytes as text where there's no TextDecoder, as on the Mac's Hermes", () => {
  const was = globalThis.TextDecoder;
  // @ts-expect-error: taken away, as on a host without one
  delete globalThis.TextDecoder;
  try {
    assert.equal(spreadsheetText(new TextEncoder().encode("Name,Price\nCafé,£3,😀\n")), "Name,Price\nCafé,£3,😀\n");
    // A byte-order mark before UTF-8 isn't part of the first heading.
    assert.equal(spreadsheetText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), "A");
    // Windows-1252's own characters between 0x80 and 0x9F: € ' " –.
    assert.equal(spreadsheetText(Uint8Array.from([0x80, 0x92, 0x93, 0x96, 0xe9])), "€’“–é");
    // UTF-8 cut short, or an overlong form, isn't UTF-8.
    assert.equal(spreadsheetText(Uint8Array.from([0x41, 0xc3])), "AÃ");
    assert.equal(spreadsheetText(Uint8Array.from([0xc0, 0xaf])), "À¯");
    assert.equal(spreadsheetText(Uint8Array.from([0xfe, 0xff, 0, 0x41, 0xd8, 0x3d, 0xde, 0])), "A😀");
    // Long enough that one String.fromCharCode call would overflow the stack.
    assert.equal(spreadsheetText(new Uint8Array(200_000).fill(0x61)).length, 200_000);
  } finally {
    globalThis.TextDecoder = was;
  }
});

test("which files are spreadsheets, and their bytes as text whatever wrote them", () => {
  for (const name of ["a.csv", "A.CSV", "b.tsv", "c.tab", "d.txt"]) assert.equal(isSpreadsheetFile(name), true, name);
  for (const name of ["a.table.zip", "a.zip", "a.xlsx", "csv", "a.csv.bak"]) assert.equal(isSpreadsheetFile(name), false, name);
  const utf8 = new TextEncoder().encode("Name,Price\nCafé,£3\n");
  assert.equal(spreadsheetText(utf8), "Name,Price\nCafé,£3\n");
  // Older Excel: one byte a letter. é is E9 and £ is A3, which aren't UTF-8.
  const latin = Uint8Array.from([...Buffer.from("Name,Price\nCaf", "latin1"), 0xe9, ...Buffer.from(",", "latin1"), 0xa3, ...Buffer.from("3\n", "latin1")]);
  assert.equal(spreadsheetText(latin), "Name,Price\nCafé,£3\n");
  // Excel's "Unicode text": UTF-16, tab separated, with its mark first.
  const utf16 = Uint8Array.from([0xff, 0xfe, ...Buffer.from("Name\tPrice\nCafé\t£3\n", "utf16le")]);
  const text = spreadsheetText(utf16);
  const table = openSpreadsheet(text, "export.txt", []).bundle.tables.export!;
  assert.deepEqual(table.schema.fields.map((f) => f.title ?? f.name), ["Name", "Price"]);
  assert.deepEqual(table.rows.map((r) => [r.name, r.price]), [["Café", "£3"]]);
});

