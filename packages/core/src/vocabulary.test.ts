import { test } from "node:test";
import assert from "node:assert/strict";
import { enumOptions, enumValues } from "./types.js";
import type { Field, Row, TableSchema } from "./types.js";
import { validate } from "./validator.js";
import { applyGroup, applySort } from "./query.js";
import { formatValue, stringFormatKind } from "./format.js";

// ---- Enum normalisation (#31) ----

test("enumOptions coerces bare strings to { value }", () => {
  const field: Field = {
    name: "status",
    type: "string",
    constraints: { enum: ["planning", "active"] },
  };
  assert.deepEqual(enumOptions(field), [
    { value: "planning" },
    { value: "active" },
  ]);
});

test("enumOptions preserves object form and mixed arrays", () => {
  const field: Field = {
    name: "status",
    type: "string",
    constraints: {
      enum: [
        { value: "planning", color: "gray", label: "Planning" },
        "active",
      ],
    },
  };
  assert.deepEqual(enumOptions(field), [
    { value: "planning", color: "gray", label: "Planning" },
    { value: "active" },
  ]);
  assert.deepEqual(enumValues(field), ["planning", "active"]);
});

test("enumOptions returns [] when no enum", () => {
  assert.deepEqual(enumOptions({ name: "x", type: "string" }), []);
  assert.deepEqual(enumOptions(undefined), []);
});

test("validator accepts the rich enum form", () => {
  const schema: TableSchema = {
    fields: [
      {
        name: "status",
        type: "string",
        constraints: {
          enum: [{ value: "a", color: "green" }, "b"],
        },
      },
    ],
  };
  assert.equal(
    validate(schema, [{ id: "r1", status: "a" }, { id: "r2", status: "b" }]).length,
    0,
  );
  const bad = validate(schema, [{ id: "r3", status: "c" }]);
  assert.equal(bad.length, 1);
  assert.match(bad[0]!.message, /not in enum/);
});

test("enum sort/group order follows declared order in object form", () => {
  const schema: TableSchema = {
    fields: [
      {
        name: "status",
        type: "string",
        constraints: {
          enum: [
            { value: "todo", color: "gray" },
            { value: "doing", color: "blue" },
            { value: "done", color: "green" },
          ],
        },
      },
    ],
  };
  const rows: Row[] = [
    { id: "1", status: "done" },
    { id: "2", status: "todo" },
    { id: "3", status: "doing" },
  ];
  const sorted = applySort(rows, [{ field: "status", direction: "asc" }], schema);
  assert.deepEqual(sorted.map((r) => r.status), ["todo", "doing", "done"]);
  const grouped = applyGroup(rows, "status", schema);
  assert.deepEqual([...grouped.keys()], ["todo", "doing", "done"]);
});

// ---- Multi-target relations (#35) ----

test("cardinality many accepts an array of ids, rejects a scalar", () => {
  const schema: TableSchema = {
    fields: [
      {
        name: "tags",
        type: "string",
        relation: { table: "tags", field: "id", cardinality: "many" },
      },
    ],
  };
  assert.equal(validate(schema, [{ id: "r1", tags: ["t1", "t2"] }]).length, 0);
  assert.equal(validate(schema, [{ id: "r2", tags: [] }]).length, 0);

  const scalar = validate(schema, [{ id: "r3", tags: "t1" }]);
  assert.equal(scalar.length, 1);
  assert.match(scalar[0]!.message, /array of relation ids/);

  const nonString = validate(schema, [{ id: "r4", tags: ["t1", 2] as unknown[] }]);
  assert.equal(nonString.length, 1);
  assert.match(nonString[0]!.message, /only string ids/);
});

test("cardinality one (default) still validates as a scalar", () => {
  const schema: TableSchema = {
    fields: [
      { name: "project", type: "string", relation: { table: "projects", field: "id" } },
    ],
  };
  assert.equal(validate(schema, [{ id: "r1", project: "p1" }]).length, 0);
});

// ---- Format helpers (#32) ----

const numField = (format: string): Field => ({ name: "n", type: "number", format });
const dateField = (format: string): Field => ({ name: "d", type: "date", format });

test("formatValue: number formats", () => {
  assert.equal(formatValue(numField("integer"), 1234.5), "1,235");
  assert.equal(formatValue(numField("decimal:2"), 1.5), "1.50");
  assert.equal(formatValue(numField("percent"), 0.5), "50%");
  assert.equal(formatValue(numField("duration:seconds"), 90), "1m 30s");
  assert.equal(formatValue(numField("duration:seconds"), 3661), "1h 1m 1s");
  assert.equal(formatValue(numField("duration:seconds"), 0), "0s");
  // Currency: locale-format varies, assert it carries the amount + a symbol.
  const usd = formatValue(numField("currency:USD"), 1234.5);
  assert.match(usd, /1,234\.50/);
  assert.match(usd, /\$|USD/);
});

test("formatValue: unknown currency code degrades, never throws", () => {
  assert.doesNotThrow(() => formatValue(numField("currency:ZZZ"), 10));
});

test("formatValue: date formats", () => {
  assert.equal(formatValue(dateField("iso"), "2026-04-15"), "2026-04-15");
  assert.equal(formatValue(dateField("iso"), "2026-04-15T09:30:00Z"), "2026-04-15");
  const long = formatValue(dateField("long"), "2026-04-15");
  assert.match(long, /2026/);
  assert.match(long, /15/);
  // weekday of 2026-04-15 is a Wednesday
  assert.match(formatValue(dateField("weekday"), "2026-04-15"), /Wednesday/);
});

test("formatValue: no format returns raw string, empty returns empty", () => {
  assert.equal(formatValue({ name: "n", type: "number" }, 42), "42");
  assert.equal(formatValue(numField("percent"), ""), "");
  assert.equal(formatValue(numField("percent"), null), "");
});

test("stringFormatKind branches only for string fields", () => {
  assert.equal(stringFormatKind({ name: "s", type: "string", format: "url" }), "url");
  assert.equal(stringFormatKind({ name: "s", type: "string", format: "markdown" }), "markdown");
  assert.equal(stringFormatKind({ name: "s", type: "string" }), "plain");
  assert.equal(stringFormatKind({ name: "n", type: "number", format: "url" }), "plain");
});

// ---- the app's display settings (personal, outside the file)

const launched = (format?: string): Field => ({ name: "launched", type: "date", ...(format ? { format } : {}) });

test("formatValue: an app's locale is used for dates and numbers", () => {
  assert.equal(formatValue(launched("long"), "2026-04-20", { locale: "en-GB" }), "20 April 2026");
  assert.equal(formatValue(launched("long"), "2026-04-20", { locale: "en-US" }), "April 20, 2026");
  assert.equal(formatValue(launched("short"), "2026-04-20", { locale: "en-GB" }), "20/04/26");
  assert.equal(formatValue(launched("short"), "2026-04-20", { locale: "en-US" }), "4/20/26");
  assert.equal(formatValue(launched("weekday"), "2026-04-20", { locale: "de-DE" }), "Montag");
  assert.equal(formatValue(numField("decimal:2"), 1234.5, { locale: "de-DE" }), "1.234,50");
});

test("formatValue: an app's default date format fills in only where the table has none", () => {
  const opts = { locale: "en-GB", dateFormat: "long" };
  assert.equal(formatValue(launched(), "2026-04-20", opts), "20 April 2026");
  // The table's own choice wins.
  assert.equal(formatValue(launched("iso"), "2026-04-20", opts), "2026-04-20");
  assert.equal(formatValue(launched("short"), "2026-04-20", opts), "20/04/26");
  // Without either, dates stay as stored (SPEC: iso is the default).
  assert.equal(formatValue(launched(), "2026-04-20"), "2026-04-20");
  // Not a date field: the date default doesn't apply.
  assert.equal(formatValue({ name: "t", type: "string" }, "2026-04-20", opts), "2026-04-20");
});

test("formatValue: without Intl.RelativeTimeFormat (Hermes), a relative date is the plain date", () => {
  const now = new Date("2026-09-26T12:00:00");
  const intl = Intl as unknown as Record<string, unknown>;
  const kept = intl.RelativeTimeFormat;
  delete intl.RelativeTimeFormat;
  try {
    assert.equal(formatValue(launched("relative"), "2026-09-25", { locale: "en-GB", now }), "2026-09-25");
    // The app-wide default, too: every date field would otherwise have thrown.
    assert.equal(formatValue(launched(), "2026-04-20", { dateFormat: "relative", now }), "2026-04-20");
  } finally {
    intl.RelativeTimeFormat = kept;
  }
  assert.equal(formatValue(launched("relative"), "2026-09-25", { locale: "en-GB", now }), "yesterday");
});

test("formatValue: a locale or currency the platform refuses gives the plainer form", () => {
  const money = { name: "m", type: "number", format: "currency:NOPE" } as const;
  assert.equal(formatValue(money, 1234.5, { locale: "en-GB" }), "1,234.5");
  const pct = { name: "p", type: "number", format: "percent" } as const;
  assert.equal(formatValue(pct, 0.25, { locale: "not a locale!" }), "0.25");
  assert.equal(formatValue(launched("long"), "2026-04-20", { locale: "not a locale!" }), "2026-04-20");
});

test("formatValue: relative dates follow the app's locale and clock", () => {
  const now = new Date("2026-09-26T12:00:00");
  assert.equal(formatValue(launched("relative"), "2026-09-25", { locale: "en-GB", now }), "yesterday");
  assert.equal(formatValue(launched("relative"), "2026-09-25", { locale: "fr-FR", now }), "hier");
  assert.equal(formatValue(launched("relative"), "2026-09-12", { locale: "en-GB", now }), "2 weeks ago");
});

test("unique: no two rows hold the same value; empty values don't count (#568)", () => {
  const schema: TableSchema = { fields: [{ name: "email", type: "string", constraints: { unique: true } }] };
  const errors = validate(schema, [
    { id: "a", email: "x@y" },
    { id: "b" },
    { id: "c", email: "" },
    { id: "d", email: "x@y" },
    { id: "e" },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.rowId, "d");
  assert.equal(errors[0]!.field, "email");
});

test("a number that isn't finite isn't a number (#568)", () => {
  const schema: TableSchema = { fields: [{ name: "n", type: "number" }] };
  assert.equal(validate(schema, [{ id: "a", n: Infinity as never }]).length, 1);
  assert.equal(validate(schema, [{ id: "a", n: 1.5 }]).length, 0);
});

test("a datetime shown in a date format keeps its time, in the viewer's clock (#568)", () => {
  const field = (format: string) => ({ name: "d", type: "datetime", format }) as Field;
  const v = "2026-04-01T13:45:00Z";
  const local = new Date(v);
  const two = (n: number) => String(n).padStart(2, "0");
  assert.equal(formatValue(field("iso"), v), `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())} ${two(local.getHours())}:45`);
  assert.match(formatValue(field("long"), v, { locale: "en-GB" }), new RegExp(`^${local.getDate()} April 2026, \\d{1,2}:45`));
  // A date stays a date.
  assert.equal(formatValue({ name: "d", type: "date", format: "long" } as Field, "2026-04-01", { locale: "en-GB" }), "1 April 2026");
});
