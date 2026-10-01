import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PILL_PALETTE, pillColors } from "./display.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const names = Object.keys(PILL_PALETTE);
const HEX = /#[0-9a-f]{6}/g;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("every pair gives the label at least 4.5:1 (WCAG AA)", () => {
  for (const [name, { light, dark }] of Object.entries(PILL_PALETTE)) {
    assert.ok(contrast(light.bg, light.fg) >= 4.5, `${name} light`);
    assert.ok(contrast(dark.bg, dark.fg) >= 4.5, `${name} dark`);
  }
});

test("the palette, the core type and the DECISIONS D43 table name the same colours", () => {
  const type = read("../../core/src/types.ts");
  const union = type.slice(type.indexOf("export type EnumColor ="), type.indexOf(";", type.indexOf("export type EnumColor =")));
  assert.deepEqual([...union.matchAll(/"(\w+)"/g)].map((m) => m[1]), names);

  const decisions = read("../../../docs/DECISIONS.md");
  const table = decisions.slice(decisions.indexOf("## D43"), decisions.indexOf("## D44"));
  const rows = [...table.matchAll(/^\| `(\w+)` \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \|$/gm)];
  assert.deepEqual(rows.map((m) => m[1]), names);
  for (const m of rows) {
    const p = PILL_PALETTE[m[1]!]!;
    assert.deepEqual(m.slice(2), [p.light.bg, p.light.fg, p.dark.bg, p.dark.fg], m[1]);
  }
});

test("the web's StyleX literals restate the palette", () => {
  const views = read("./views.tsx");
  for (const name of names) {
    const style = `pill${name[0]!.toUpperCase()}${name.slice(1)}`;
    const line = views.split("\n").find((l) => l.trimStart().startsWith(`${style}:`));
    assert.ok(line, `${style} is defined`);
    const p = PILL_PALETTE[name]!;
    assert.deepEqual(line.match(HEX), [p.light.bg, p.dark.bg, p.light.fg, p.dark.fg], name);
    assert.ok(views.includes(`${name}: styles.${style},`), `${name} is in PILL_COLORS`);
  }
});

test("no colour, an unknown name, or an object property name is gray", () => {
  const gray = PILL_PALETTE["gray"];
  for (const color of [undefined, "", "magenta", "toString", "constructor", "__proto__"]) assert.equal(pillColors(color), gray, String(color));
  assert.equal(pillColors("mint"), PILL_PALETTE["mint"]);
});
