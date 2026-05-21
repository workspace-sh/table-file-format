import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAddress,
  formatAddress,
  resolveRow,
  type Address,
} from "./address.js";
import type { ParsedTable } from "./types.js";

describe("parseAddress", () => {
  it("parses a bare table path with no fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table"), {
      tablePath: "docs/projects.table",
    });
  });

  it("parses a relative path", () => {
    assert.deepEqual(parseAddress("../suppliers.table"), {
      tablePath: "../suppliers.table",
    });
  });

  it("parses row= fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table#row=p1"), {
      tablePath: "docs/projects.table",
      rowId: "p1",
    });
  });

  it("parses view= fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table#view=v3"), {
      tablePath: "docs/projects.table",
      viewId: "v3",
    });
  });

  it("parses field= fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table#row=p1&field=status"), {
      tablePath: "docs/projects.table",
      rowId: "p1",
      fieldName: "status",
    });
  });

  it("parses combined row + view fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table#row=p1&view=v3"), {
      tablePath: "docs/projects.table",
      rowId: "p1",
      viewId: "v3",
    });
  });

  it("preserves unknown keys in extra", () => {
    assert.deepEqual(
      parseAddress("docs/projects.table#row=p1&query=foo&highlight=status"),
      {
        tablePath: "docs/projects.table",
        rowId: "p1",
        extra: { query: "foo", highlight: "status" },
      },
    );
  });

  it("returns null for empty input", () => {
    assert.equal(parseAddress(""), null);
  });

  it("returns null when path is missing (fragment-only is not a complete address)", () => {
    assert.equal(parseAddress("#row=p1"), null);
  });

  it("tolerates trailing # with empty fragment", () => {
    assert.deepEqual(parseAddress("docs/projects.table#"), {
      tablePath: "docs/projects.table",
    });
  });

  it("ignores malformed pairs without =", () => {
    assert.deepEqual(parseAddress("docs/projects.table#row=p1&badpair"), {
      tablePath: "docs/projects.table",
      rowId: "p1",
    });
  });

  it("ignores pairs with empty key or value", () => {
    assert.deepEqual(parseAddress("docs/projects.table#=foo&row="), {
      tablePath: "docs/projects.table",
    });
  });
});

describe("formatAddress", () => {
  it("formats bare table path with no fragment", () => {
    assert.equal(
      formatAddress({ tablePath: "docs/projects.table" }),
      "docs/projects.table",
    );
  });

  it("formats row=", () => {
    assert.equal(
      formatAddress({ tablePath: "docs/projects.table", rowId: "p1" }),
      "docs/projects.table#row=p1",
    );
  });

  it("formats combined fragment in spec order (row, view, field)", () => {
    assert.equal(
      formatAddress({
        tablePath: "docs/projects.table",
        viewId: "v3",
        rowId: "p1",
        fieldName: "status",
      }),
      "docs/projects.table#row=p1&view=v3&field=status",
    );
  });

  it("appends extra keys after reserved ones", () => {
    assert.equal(
      formatAddress({
        tablePath: "docs/projects.table",
        rowId: "p1",
        extra: { query: "foo" },
      }),
      "docs/projects.table#row=p1&query=foo",
    );
  });
});

describe("parseAddress + formatAddress round-trip", () => {
  const cases: string[] = [
    "docs/projects.table",
    "../suppliers.table",
    "docs/projects.table#row=p1",
    "docs/projects.table#view=v3",
    "docs/projects.table#row=p1&view=v3",
    "docs/projects.table#row=p1&view=v3&field=status",
  ];
  for (const input of cases) {
    it(`round-trips ${input}`, () => {
      const parsed = parseAddress(input);
      assert.ok(parsed, `parse failed for ${input}`);
      assert.equal(formatAddress(parsed!), input);
    });
  }
});

describe("resolveRow", () => {
  const table: ParsedTable = {
    path: "docs/projects.table",
    schema: { fields: [{ name: "title", type: "string" }] },
    rows: [
      { id: "p1", title: "Workspace v1" },
      { id: "p2", title: "Spike" },
    ],
    views: [],
    meta: {},
  };
  const lookup = (path: string) =>
    path === "docs/projects.table" ? table : null;

  it("finds the row when the address resolves", async () => {
    const row = await resolveRow("docs/projects.table#row=p1", lookup);
    assert.equal(row?.id, "p1");
    assert.equal(row?.title, "Workspace v1");
  });

  it("returns null on dangling row id (table loads but row absent)", async () => {
    const row = await resolveRow("docs/projects.table#row=does_not_exist", lookup);
    assert.equal(row, null);
  });

  it("returns null when the table lookup fails", async () => {
    const row = await resolveRow("docs/missing.table#row=p1", lookup);
    assert.equal(row, null);
  });

  it("returns null when the address has no rowId", async () => {
    const row = await resolveRow("docs/projects.table", lookup);
    assert.equal(row, null);
  });

  it("returns null for an unparseable address", async () => {
    const row = await resolveRow("", lookup);
    assert.equal(row, null);
  });

  it("accepts a pre-parsed Address object too", async () => {
    const addr: Address = { tablePath: "docs/projects.table", rowId: "p2" };
    const row = await resolveRow(addr, lookup);
    assert.equal(row?.id, "p2");
  });

  it("awaits async lookups", async () => {
    const asyncLookup = (path: string) =>
      Promise.resolve(path === "docs/projects.table" ? table : null);
    const row = await resolveRow("docs/projects.table#row=p1", asyncLookup);
    assert.equal(row?.id, "p1");
  });
});
