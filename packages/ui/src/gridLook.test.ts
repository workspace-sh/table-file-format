import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gridLook } from "./gridLook.ts";
import { DEFAULT_ROW_HEIGHT } from "./display.ts";

const source = readFileSync(new URL("./views.tsx", import.meta.url), "utf8");

/** A style's block in views.tsx's css.create, as written. */
function block(name: string): string {
  const start = source.indexOf(`\n  ${name}: {\n`);
  assert.notEqual(start, -1, `${name} is in views.tsx`);
  const end = source.indexOf("\n  },\n", start);
  return source.slice(start, end);
}

function pair(text: string, prop: string): { light: string; dark: string } {
  const m = new RegExp(`${prop}: \\{\\s*default: "(#[0-9a-fA-F]+)",\\s*"@media \\(prefers-color-scheme: dark\\)": "(#[0-9a-fA-F]+)"`).exec(text);
  assert.ok(m, `${prop} has a light/dark pair`);
  return { light: m[1]!, dark: m[2]! };
}

const has = (text: string, line: string) => assert.ok(text.includes(line), `has ${line}`);
const colour = (c: { light: string; dark: string }) => ({ light: c.light, dark: c.dark });

test("gridLook is the grid's cells as views.tsx draws them", () => {
  const cell = block("tableCell");
  has(cell, `paddingInline: ${gridLook.cellPaddingInline},`);
  has(cell, `paddingBlock: ${gridLook.cellPaddingBlock},`);
  has(cell, `fontSize: ${gridLook.fontSize},`);
  assert.deepEqual(pair(cell, "color"), colour(gridLook.text));
});

test("gridLook's rows are the grid's default row height", () => {
  assert.equal(gridLook.minRowHeight, DEFAULT_ROW_HEIGHT);
});

test("gridLook's header is the grid's header", () => {
  const header = block("tableHeaderCell");
  has(header, `fontSize: ${gridLook.headerFontSize},`);
  has(header, `fontWeight: "${gridLook.headerFontWeight}",`);
  has(header, `letterSpacing: ${gridLook.headerLetterSpacing},`);
  assert.equal(header.includes('textTransform: "uppercase",'), gridLook.headerCapitals);
  assert.deepEqual(pair(header, "color"), colour(gridLook.headerText));
  assert.deepEqual(pair(block("tableHeaderRow"), "backgroundColor"), colour(gridLook.headerBackground));
});

test("gridLook's lines and frame are the grid's", () => {
  assert.deepEqual(pair(block("tableRow"), "borderBottomColor"), colour(gridLook.line));
  assert.deepEqual(pair(block("tableCellSeparator"), "borderInlineEndColor"), colour(gridLook.line));
  const frame = block("table");
  has(frame, `borderRadius: ${gridLook.cornerRadius},`);
  assert.deepEqual(pair(frame, "borderColor"), colour(gridLook.line));
});

test("off iOS and the Mac, gridLook names no platform colours", () => {
  for (const c of [gridLook.text, gridLook.headerText, gridLook.headerBackground, gridLook.line]) {
    assert.equal(c.platform, undefined);
  }
});
