import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SYSTEM_COLOR_ROLES, swapSystemColors } from "./systemColorRoles.ts";

const DARK = "@media (prefers-color-scheme: dark)";

test("every mapped pair is still in views.tsx, or its role has stopped mapping on iOS", () => {
  const source = readFileSync(new URL("./views.tsx", import.meta.url), "utf8").toLowerCase();
  const written = new Set<string>();
  const pair = /default: "(#[0-9a-f]+)",\s*"@media \(prefers-color-scheme: dark\)": "(#[0-9a-f]+)"/g;
  for (const m of source.matchAll(pair)) written.add(`${m[1]}/${m[2]}`);
  const missing = Object.entries(SYSTEM_COLOR_ROLES).filter(([colors]) => !written.has(colors));
  assert.deepEqual(missing, [], `no longer in views.tsx: ${missing.map(([c, r]) => `${r} (${c})`).join(", ")}`);
});

test("a known pair becomes its role, an unknown one stays, and pills are skipped", () => {
  const styles = {
    text: { color: { default: "#1C1C1E", [DARK]: "#f5f5f7" }, fontSize: 13 },
    other: { color: { default: "#123456", [DARK]: "#654321" } },
    hovered: { backgroundColor: { default: "#3478f6", [DARK]: "#0a84ff", ":hover": "#000" } },
    pillBlue: { color: { default: "#1d4ed8", [DARK]: "#8ab4ff" } },
    at: (top: number) => ({ top, borderColor: { default: "#e5e5ea", [DARK]: "#26262b" } }),
  };
  swapSystemColors(styles, (role) => `system:${role}`);
  assert.equal(styles.text.color, "system:label");
  assert.equal(styles.text.fontSize, 13);
  assert.deepEqual(styles.other.color, { default: "#123456", [DARK]: "#654321" });
  assert.deepEqual(styles.hovered.backgroundColor, { default: "#3478f6", [DARK]: "#0a84ff", ":hover": "#000" });
  assert.deepEqual(styles.pillBlue.color, { default: "#1d4ed8", [DARK]: "#8ab4ff" });
  assert.deepEqual(styles.at(4), { top: 4, borderColor: "system:separator" });
});
