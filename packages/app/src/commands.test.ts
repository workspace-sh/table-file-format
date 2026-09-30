import { test } from "node:test";
import assert from "node:assert/strict";

import { appCommands } from "./commands.ts";

test("every command once, in menu order, with no two sharing a key", () => {
  const all = appCommands({ sidebarCollapsed: false, filesMode: false });
  assert.deepEqual(all.map((c) => c.id), [
    "new-file",
    "open-folder",
    "open-zip",
    "export-zip",
    "copy-link",
    "tables-mode",
    "files-mode",
    "toggle-sidebar",
    "go-back",
    "go-forward",
  ]);
  const keys = all.map((c) => `${c.shift ? "shift+" : ""}${c.option ? "option+" : ""}${c.key}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(all.filter((c) => c.menu === "File").every((c) => c.label.endsWith("…")), "a dialog follows each File command");
});

test("the sidebar's label and the mode's tick follow the state", () => {
  const label = (sidebarCollapsed: boolean) =>
    appCommands({ sidebarCollapsed, filesMode: false }).find((c) => c.id === "toggle-sidebar")!.label;
  assert.equal(label(false), "Hide Sidebar");
  assert.equal(label(true), "Show Sidebar");
  const ticked = (filesMode: boolean) =>
    appCommands({ sidebarCollapsed: false, filesMode }).filter((c) => c.checked).map((c) => c.id);
  assert.deepEqual(ticked(false), ["tables-mode"]);
  assert.deepEqual(ticked(true), ["files-mode"]);
});

test("back and forward are there only when history has somewhere to go, with GNOME's keys for GTK", () => {
  const at = (canGoBack: boolean, canGoForward: boolean) =>
    Object.fromEntries(
      appCommands({ sidebarCollapsed: false, filesMode: false, canGoBack, canGoForward })
        .filter((c) => c.menu === "Go")
        .map((c) => [c.id, [c.enabled, c.key, c.gtkAccel]]),
    );
  assert.deepEqual(at(true, false), { "go-back": [true, "[", "<Alt>Left"], "go-forward": [false, "]", "<Alt>Right"] });
  assert.deepEqual(at(false, true)["go-forward"], [true, "]", "<Alt>Right"]);
  const copy = appCommands({ sidebarCollapsed: false, filesMode: false }).find((c) => c.id === "copy-link")!;
  assert.deepEqual([copy.menu, copy.label, copy.key, copy.option], ["Edit", "Copy Link to View", "c", true]);
});
