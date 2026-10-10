import { test } from "node:test";
import assert from "node:assert/strict";

import { appCommands, gtkAccelOf, hintWithShortcut, shortcutText, TOOLBAR_HINTS } from "./commands.ts";

test("every command once, in menu order, with no two sharing a key", () => {
  const all = appCommands({ sidebarCollapsed: false, filesMode: false });
  assert.deepEqual(all.map((c) => c.id), [
    "new-file",
    "open-folder",
    "open-zip",
    "export-zip",
    "undo",
    "redo",
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

test("undo and redo are in Edit on Z, there only when the table has a step to take", () => {
  const at = (canUndo: boolean, canRedo: boolean) =>
    Object.fromEntries(
      appCommands({ sidebarCollapsed: false, filesMode: false, canUndo, canRedo })
        .filter((c) => c.id === "undo" || c.id === "redo")
        .map((c) => [c.id, [c.menu, c.enabled, gtkAccelOf(c), shortcutText(c, "mac")]]),
    );
  assert.deepEqual(at(true, false), { undo: ["Edit", true, "<Control>z", "⌘Z"], redo: ["Edit", false, "<Control><Shift>z", "⇧⌘Z"] });
  assert.deepEqual(at(false, true).redo, ["Edit", true, "<Control><Shift>z", "⇧⌘Z"]);
  assert.equal(appCommands({ sidebarCollapsed: false, filesMode: false }).find((c) => c.id === "undo")!.enabled, false);
  // Named for what they'd act on, when the state says.
  const labels = (undoName: string | null, redoName: string | null) =>
    appCommands({ sidebarCollapsed: false, filesMode: false, undoName, redoName })
      .filter((c) => c.id === "undo" || c.id === "redo")
      .map((c) => c.label);
  assert.deepEqual(labels(null, null), ["Undo", "Redo"]);
  assert.deepEqual(labels("Delete Row", "Edit Title"), ["Undo Delete Row", "Redo Edit Title"]);
});

test("GTK accelerators: Control with the key, GNOME's own where it differs", () => {
  const accel = (id: string) => gtkAccelOf(appCommands({ sidebarCollapsed: false, filesMode: false }).find((c) => c.id === id)!);
  assert.equal(accel("new-file"), "<Control>n");
  assert.equal(accel("open-zip"), "<Control><Shift>o");
  assert.equal(accel("copy-link"), "<Control><Alt>c");
  assert.equal(accel("toggle-sidebar"), "<Control>b");
  assert.equal(accel("go-back"), "<Alt>Left");
});


test("shortcuts read as each platform writes them", () => {
  const all = appCommands({ sidebarCollapsed: false, filesMode: false });
  const cmd = (id: string) => all.find((c) => c.id === id)!;
  assert.deepEqual(["mac", "web", "gtk"].map((p) => shortcutText(cmd("toggle-sidebar"), p as "mac")), ["⌘B", "⌘B / Ctrl+B", "Ctrl+B"]);
  assert.equal(shortcutText(cmd("open-zip"), "mac"), "⇧⌘O");
  assert.equal(shortcutText(cmd("open-zip"), "gtk"), "Ctrl+Shift+O");
  assert.equal(shortcutText(cmd("copy-link"), "mac"), "⌥⌘C");
  assert.equal(shortcutText(cmd("go-back"), "mac"), "⌘[");
  assert.equal(shortcutText(cmd("go-back"), "gtk"), "Alt+Left");
  assert.equal(shortcutText({ ...cmd("go-back"), gtkAccel: "<Control><Shift>Tab" }, "gtk"), "Ctrl+Shift+Tab");
});

test("hints: the sidebar's follows its state; with its shortcut, as the web says it", () => {
  const sidebar = (collapsed: boolean) =>
    appCommands({ sidebarCollapsed: collapsed, filesMode: false }).find((c) => c.id === "toggle-sidebar")!;
  assert.equal(hintWithShortcut(sidebar(false), "web"), "Hide the sidebar (⌘B / Ctrl+B)");
  assert.equal(hintWithShortcut(sidebar(true), "mac"), "Show the sidebar (⌘B)");
  const exportZip = appCommands({ sidebarCollapsed: false, filesMode: false }).find((c) => c.id === "export-zip")!;
  assert.match(exportZip.hint!, /^Save this table as a \.table\.zip/);
  assert.match(TOOLBAR_HINTS.viewSettings, /^Name, layout, filters/);
});
