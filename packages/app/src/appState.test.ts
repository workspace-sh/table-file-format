import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";

import { derive, initialAppState, tableApp, viewCallbacks, viewIdOf, type AppAction, type AppState } from "./appState.ts";
import { fromBundle } from "./bundles.ts";
import { newView } from "./creating.ts";
import { viewAddress } from "./history.ts";
import type { Library } from "./library.ts";

const examples = (): Library => {
  const tables: Record<string, ParsedTable> = {};
  const bundles: Record<string, BundleMeta> = {};
  for (const [key, b] of Object.entries(fixtures)) {
    Object.assign(tables, fromBundle(key, b));
    bundles[key] = b.meta;
  }
  return { tables, bundles, paths: {}, problems: {} };
};

const start = (over: Partial<Parameters<typeof initialAppState>[0]> = {}): AppState => {
  const { tables, bundles } = examples();
  return initialAppState({ tables, bundles, ...over });
};

const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(tableApp, state);

const rowIds = (s: AppState, key = s.active) => s.tables[key]!.rows.map((r) => r.id);
const viewOf = (s: AppState) => viewIdOf(s, s.active);

// Starting

test("starts on the default table's first view, with its address recorded and its file unfolded", () => {
  const s = start({ stored: { sidebar: { foldedFiles: ["projects", "crm"] } } });
  assert.equal(s.active, "projects/projects");
  assert.equal(viewOf(s), "v1");
  assert.equal(s.history.at, viewAddress("projects/projects", "v1"));
  assert.deepEqual(s.sidebar.foldedFiles, ["crm"]);
  assert.deepEqual(s.dirty, []);
  assert.equal(s.asking, null);
});

test("starts at an address: its table, its view, and its row's page when it has one", () => {
  const s = start({ start: viewAddress("projects/projects", "v4", "p10") });
  assert.equal(s.active, "projects/projects");
  assert.equal(viewOf(s), "v4");
  assert.equal(s.openPage, "p10");
  assert.equal(start({ start: "nowhere.table#view=x" }).active, "projects/projects");
});

test("the viewer's stored settings come in as they were", () => {
  const s = start({ stored: { display: { locale: "fr-FR" }, arrangements: { "crm/deals": { all: { sort: null } } } } });
  assert.equal(s.display.locale, "fr-FR");
  assert.deepEqual(s.arrangements, { "crm/deals": { all: { sort: null } } });
});

// Where you are

test("showTable shows the table on the view it was left on, and closes a page open elsewhere", () => {
  let s = run(start(), { type: "showView", key: "crm/deals", viewId: "open" }, { type: "showTable", key: "projects/projects" });
  s = run(s, { type: "openPage", rowId: "p10" }, { type: "showTable", key: "crm/deals" });
  assert.equal(s.active, "crm/deals");
  assert.equal(viewOf(s), "open");
  assert.equal(s.openPage, null);
});

test("choosing a view from the sidebar closes the page open, even in the same table", () => {
  const s = run(start(), { type: "openPage", rowId: "p10" }, { type: "showView", key: "projects/projects", viewId: "v2" });
  assert.equal(s.openPage, null);
  const t = run(start(), { type: "openPage", rowId: "p10" }, { type: "showTable", key: "projects/projects" });
  assert.equal(t.openPage, null);
});

test("showTable and showView ignore what isn't held", () => {
  const s = start();
  assert.equal(tableApp(s, { type: "showTable", key: "nope/nope" }), s);
  assert.equal(tableApp(s, { type: "showView", key: "crm/deals", viewId: "nope" }), s);
});

test("openPage opens a row of the table on screen, and null closes it", () => {
  let s = run(start(), { type: "openPage", rowId: "p10" });
  assert.equal(s.openPage, "p10");
  assert.equal(tableApp(s, { type: "openPage", rowId: "t1" }), s, "a row that isn't in this table");
  s = run(s, { type: "openPage", rowId: null });
  assert.equal(s.openPage, null);
});

test("follow goes where an address leads, on the Tables side, opening the row's page when it has one", () => {
  const s = run(
    start({ stored: { sidebar: { files: true } } }),
    { type: "follow", target: { key: "crm/deals", viewId: "all", openBody: "dl-1" } },
  );
  assert.equal(s.active, "crm/deals");
  assert.equal(viewOf(s), "all");
  assert.equal(s.openPage, "dl-1");
  assert.equal(s.sidebar.files, undefined);
});

test("search and settings are set as asked", () => {
  const s = run(start(), { type: "search", text: "ship" }, { type: "settings", open: true });
  assert.equal(s.search, "ship");
  assert.equal(s.settingsOpen, true);
});

// Rule 1: leaving a view clears its search and closes its settings

test("leaving: another view or table clears the search and closes the settings", () => {
  const busy = run(start(), { type: "search", text: "ship" }, { type: "settings", open: true });
  for (const action of [
    { type: "showView", key: "projects/projects", viewId: "v2" },
    { type: "showTable", key: "crm/deals" },
    { type: "follow", target: { key: "crm/deals", openBody: null } },
  ] satisfies AppAction[]) {
    const s = tableApp(busy, action);
    assert.equal(s.search, "", action.type);
    assert.equal(s.settingsOpen, false, action.type);
  }
});

test("leaving: choosing the view already on screen keeps both", () => {
  const busy = run(start(), { type: "search", text: "ship" }, { type: "settings", open: true });
  const s = run(busy, { type: "showView", key: "projects/projects", viewId: "v1" }, { type: "showTable", key: "projects/projects" });
  assert.equal(s.search, "ship");
  assert.equal(s.settingsOpen, true);
});

test("leaving: back and forward clear them too", () => {
  let s = run(start(), { type: "showTable", key: "crm/deals" }, { type: "search", text: "x" }, { type: "back" });
  assert.equal(s.active, "projects/projects");
  assert.equal(s.search, "");
  s = run(s, { type: "search", text: "y" }, { type: "settings", open: true }, { type: "forward" });
  assert.equal(s.active, "crm/deals");
  assert.equal(s.search, "");
  assert.equal(s.settingsOpen, false);
});

test("leaving: a new view is the exception, opening on its settings", () => {
  const s = run(start(), { type: "search", text: "ship" }, { type: "addView", id: "new-1" });
  assert.equal(viewOf(s), "new-1");
  assert.deepEqual(s.tables["projects/projects"]!.views.at(-1), newView("new-1"));
  assert.equal(s.settingsOpen, true);
  assert.equal(s.search, "");
});

test("leaving: a reset and an opened file change the table on screen, so they clear too", () => {
  const busy = run(start(), { type: "search", text: "x" }, { type: "settings", open: true }, { type: "showTable", key: "crm/deals" }, { type: "search", text: "y" });
  const reset = run(busy, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.equal(reset.search, "");
  const opened = run(busy, { type: "opened", library: { ...one("notes"), paths: { notes: "/x/notes.table" } } });
  assert.equal(opened.active, "notes/notes");
  assert.equal(opened.search, "");
});

// Rule 2: history

test("history: each view shown is recorded once, and back and forward walk it", () => {
  let s = run(
    start(),
    { type: "showTable", key: "crm/deals" },
    { type: "showTable", key: "crm/deals" },
    { type: "showView", key: "crm/deals", viewId: "open" },
  );
  assert.deepEqual(s.history.back, [viewAddress("projects/projects", "v1"), viewAddress("crm/deals", "pipeline")]);
  s = run(s, { type: "back" }, { type: "back" });
  assert.equal(s.active, "projects/projects");
  assert.equal(derive(s).canGoBack, false);
  assert.equal(derive(s).canGoForward, true);
  s = run(s, { type: "forward" });
  assert.equal(viewOf(s), "pipeline");
});

test("history: back with nowhere to go changes nothing", () => {
  const s = start();
  assert.equal(tableApp(s, { type: "back" }), s);
  assert.equal(tableApp(s, { type: "forward" }), s);
});

test("history: back skips a view deleted since, and leaves a page open behind", () => {
  let s = run(start(), { type: "showTable", key: "crm/deals" }, { type: "openPage", rowId: "dl-1" }, { type: "showTable", key: "projects/projects" });
  s = run(s, { type: "addView", id: "gone" }, { type: "deleteView" }, { type: "answer", response: "delete" });
  assert.equal(viewOf(s), "v1");
  s = run(s, { type: "back" });
  assert.equal(s.active, "crm/deals");
  assert.equal(viewOf(s), "pipeline");
  assert.equal(s.openPage, null);
});

test("history: a reset starts it again", () => {
  const s = run(start(), { type: "showTable", key: "crm/deals" }, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.deepEqual(s.history, { back: [], at: viewAddress("projects/projects", "v1"), forward: [] });
});

// Rule 3: the file on screen unfolds

test("file unfold: showing a table in a folded file unfolds it; folding it again is the viewer's", () => {
  let s = run(start(), { type: "toggleFile", bundle: "crm" });
  assert.deepEqual(s.sidebar.foldedFiles, ["crm"]);
  s = run(s, { type: "follow", target: { key: "crm/deals", openBody: null } });
  assert.deepEqual(s.sidebar.foldedFiles, []);
  s = run(s, { type: "toggleFile", bundle: "crm" });
  assert.deepEqual(s.sidebar.foldedFiles, ["crm"], "still on screen, folded by the viewer");
});

// Rule 4: questions, and edits

test("edits change the table on screen and mark its bundle to write", () => {
  const s = run(
    start(),
    { type: "showTable", key: "crm/deals" },
    { type: "updateRow", rowId: "dl-1", field: "title", value: "Renamed" },
    { type: "updateBody", rowId: "dl-2", content: "# Notes" },
    { type: "addChoice", name: "stage", value: "Parked" },
  );
  const deals = s.tables["crm/deals"]!;
  assert.equal(deals.rows.find((r) => r.id === "dl-1")!.title, "Renamed");
  assert.equal(deals.bodies?.["dl-2"], "# Notes");
  assert.deepEqual(s.dirty, ["crm"]);
});

test("an edit that changes nothing marks nothing", () => {
  const s = start();
  assert.equal(tableApp(s, { type: "moveField", name: "title", delta: -1 }), s);
  assert.equal(tableApp(s, { type: "addChoice", name: "nope", value: "x" }), s);
});

test("fields: added to the view on screen, patched and moved", () => {
  let s = run(start(), { type: "addField", field: { name: "extra", type: "string" } });
  assert.equal(s.tables["projects/projects"]!.schema.fields.at(-1)!.name, "extra");
  s = run(s, { type: "moveField", name: "extra", delta: -1 }, { type: "updateField", name: "extra", patch: { title: "Extra" } });
  const fields = s.tables["projects/projects"]!.schema.fields;
  assert.equal(fields.at(-2)!.name, "extra");
  assert.equal(fields.at(-2)!.title, "Extra");
  assert.deepEqual(s.dirty, ["projects"]);
});

test("addRow puts the adapter's id at the end", () => {
  const s = run(start(), { type: "addRow", id: "r-new" });
  assert.equal(rowIds(s).at(-1), "r-new");
});

test("insertRow goes where the sheet says, and nowhere a sort decides", () => {
  let s = run(start(), { type: "showView", key: "household-budget/budget", viewId: "sheet" });
  const before = rowIds(s);
  s = run(s, { type: "insertRow", anchor: before[1]!, where: "above", id: "r-new" });
  assert.deepEqual(rowIds(s).slice(0, 3), [before[0], "r-new", before[1]]);
  const sorted = run(start(), { type: "showView", key: "household-budget/ledger", viewId: "by-date" });
  assert.equal(tableApp(sorted, { type: "insertRow", anchor: "opening", where: "below", id: "x" }), sorted);
});

test("insertRow is refused outside a Sheet view, even an unsorted one", () => {
  const s = start();
  assert.equal(tableApp(s, { type: "insertRow", anchor: "p1", where: "below", id: "x" }), s);
});

test("a page open closes when another table shows, even one with a row of the same id", () => {
  const { tables } = examples();
  const copy: Library = {
    tables: { "crm-2/companies": { ...tables["crm/companies"]!, path: "crm-2.table/tables/companies" } },
    bundles: { "crm-2": { title: "CRM", tables: ["companies"] } },
    paths: { "crm-2": "/x/crm-2.table" },
    problems: {},
  };
  const open = run(start(), { type: "showTable", key: "crm/companies" }, { type: "openPage", rowId: "co-atlas" });
  assert.equal(open.openPage, "co-atlas");
  const s = run(open, { type: "opened", library: copy });
  assert.equal(s.active, "crm-2/companies");
  assert.equal(s.openPage, null);
  const back = run(s, { type: "openPage", rowId: "co-atlas" }, { type: "back" });
  assert.equal(back.active, "crm/companies");
  assert.equal(back.openPage, null);
});

test("deleteRow asks first; cancel keeps the row, delete removes it and closes its page", () => {
  const asked = run(start(), { type: "openPage", rowId: "p10" }, { type: "deleteRow", rowId: "p10" });
  assert.equal(asked.asking?.kind, "confirm");
  assert.match(asked.asking!.kind === "confirm" ? asked.asking.confirm.body : "", /page/);
  assert.ok(rowIds(asked).includes("p10"), "nothing changes before the answer");
  const kept = run(asked, { type: "answer", response: "cancel" });
  assert.equal(kept.asking, null);
  assert.ok(rowIds(kept).includes("p10"));
  assert.deepEqual(kept.dirty, []);
  const gone = run(asked, { type: "answer", response: "delete" });
  assert.equal(gone.asking, null);
  assert.ok(!rowIds(gone).includes("p10"));
  assert.equal(gone.openPage, null);
  assert.deepEqual(gone.dirty, ["projects"]);
});

test("deleteRow leaves another row's page open", () => {
  const s = run(start(), { type: "openPage", rowId: "p13" }, { type: "deleteRow", rowId: "p10" }, { type: "answer", response: "delete" });
  assert.equal(s.openPage, "p13");
});

test("an answer that isn't one of the question's responses does nothing", () => {
  const asked = run(start(), { type: "deleteRow", rowId: "p1" });
  const s = run(asked, { type: "answer", response: "reset" });
  assert.equal(s.asking, null);
  assert.ok(rowIds(s).includes("p1"));
  assert.equal(tableApp(start(), { type: "answer", response: "delete" }).asking, null);
});

test("deleteView asks first, then shows the table's next view", () => {
  const asked = run(start(), { type: "showView", key: "crm/deals", viewId: "open" }, { type: "deleteView" });
  assert.equal(asked.asking?.kind, "confirm");
  assert.ok(asked.tables["crm/deals"]!.views.some((v) => v.id === "open"));
  const s = run(asked, { type: "answer", response: "delete" });
  assert.ok(!s.tables["crm/deals"]!.views.some((v) => v.id === "open"));
  assert.equal(viewOf(s), "pipeline");
  assert.equal(s.viewIds["crm/deals"], "pipeline", "no table is left pointing at a view that's gone");
  assert.deepEqual(s.dirty, ["crm"]);
});

test("deleteView of a table's last view asks nothing and does nothing", () => {
  const s = run(start(), { type: "showTable", key: "shop/lines" });
  assert.equal(tableApp(s, { type: "deleteView" }), s);
});

test("updateView: most changes are made at once", () => {
  const s = run(start(), { type: "updateView", patch: { name: "Everything" } });
  assert.equal(s.asking, null);
  assert.equal(s.tables["projects/projects"]!.views[0]!.name, "Everything");
  assert.deepEqual(s.dirty, ["projects"]);
});

test("updateView: turning off a sheet that formulas read asks first, and stop makes the change", () => {
  const asked = run(start(), { type: "showView", key: "household-budget/ledger", viewId: "by-date" }, { type: "updateView", patch: { coordinates: undefined } });
  assert.equal(asked.asking?.kind, "confirm");
  assert.equal(asked.tables["household-budget/ledger"]!.views[0]!.coordinates, true);
  assert.equal(run(asked, { type: "answer", response: "cancel" }).tables["household-budget/ledger"]!.views[0]!.coordinates, true);
  const s = run(asked, { type: "answer", response: "stop" });
  assert.equal(s.tables["household-budget/ledger"]!.views[0]!.coordinates, undefined);
  assert.deepEqual(s.dirty, ["household-budget"]);
});

test("reset asks first; reset brings the examples back, keeping folders opened from disk", () => {
  const mine = { ...one("notes"), paths: { notes: "/home/me/notes.table" } };
  const edited = run(
    start(),
    { type: "opened", library: mine },
    { type: "showTable", key: "projects/projects" },
    { type: "updateRow", rowId: "p1", field: "title", value: "Changed" },
    { type: "reset", fresh: examples() },
  );
  assert.equal(edited.asking?.kind, "confirm");
  assert.match(edited.asking!.kind === "confirm" ? edited.asking.confirm.body : "", /Folders you opened from disk/);
  const s = run(edited, { type: "answer", response: "reset" });
  assert.equal(s.tables["projects/projects"]!.rows[0]!.title, examples().tables["projects/projects"]!.rows[0]!.title);
  assert.ok(s.tables["notes/notes"], "the opened folder is kept");
  assert.deepEqual(s.opened, { notes: "/home/me/notes.table" });
  assert.deepEqual(s.dirty, [], "nothing of the examples is left to write");
  assert.equal(s.active, "projects/projects");
});

test("reset to nothing of the examples still shows a held table", () => {
  const empty: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const s = run(start(), { type: "opened", library: { ...one("notes"), paths: { notes: "/x" } } }, { type: "showTable", key: "crm/deals" }, { type: "reset", fresh: empty }, { type: "answer", response: "reset" });
  assert.equal(s.active, "notes/notes");
});

test("create asks for a name; a name makes it and shows it, and none makes nothing", () => {
  const asked = run(start(), { type: "create", making: { kind: "table", bundle: "crm" } });
  assert.equal(asked.asking?.kind, "name");
  assert.equal(asked.asking!.kind === "name" ? asked.asking.prompt.heading : "", "New table in CRM");
  assert.equal(run(asked, { type: "answer", response: "create", text: "  " }).tables, asked.tables);
  assert.equal(run(asked, { type: "answer", response: "cancel", text: "Leads" }).tables, asked.tables);
  const s = run(asked, { type: "answer", response: "create", text: "Leads" });
  assert.equal(s.asking, null);
  assert.equal(s.active, "crm/leads");
  assert.deepEqual(s.bundles["crm"]!.tables?.at(-1), "leads");
  assert.deepEqual(s.dirty, ["crm"]);
});

test("create a file makes a bundle of its own", () => {
  const s = run(start(), { type: "create", making: { kind: "file" } }, { type: "answer", response: "create", text: "Trips" });
  assert.equal(s.active, "trips/trips");
  assert.deepEqual(s.dirty, ["trips"]);
});

// This viewer's own

test("arrange is this viewer's own; save for everyone writes it into the view, reset drops it", () => {
  let s = run(start(), { type: "arrange", patch: { sort: [{ field: "title", direction: "asc" }] } });
  assert.deepEqual(s.arrangements["projects/projects"]?.["v1"], { sort: [{ field: "title", direction: "asc" }] });
  assert.equal(s.tables["projects/projects"]!.views[0]!.sort, undefined);
  assert.deepEqual(s.dirty, []);
  assert.equal(derive(s).arranged, true);
  const dropped = run(s, { type: "resetArrangement" });
  assert.deepEqual(dropped.arrangements, {});
  s = run(s, { type: "saveForEveryone" });
  assert.deepEqual(s.tables["projects/projects"]!.views[0]!.sort, [{ field: "title", direction: "asc" }]);
  assert.deepEqual(s.arrangements, {});
  assert.deepEqual(s.dirty, ["projects"]);
  assert.equal(tableApp(s, { type: "saveForEveryone" }), s, "nothing arranged, nothing saved");
});

test("Cancel puts back everything the view settings changed; Done keeps it", () => {
  const before = start({ stored: { arrangements: { "projects/projects": { v1: { filter: [{ field: "status", operator: "eq", value: "active" }] } } } } });
  const changed = run(
    before,
    { type: "settings", open: true },
    { type: "updateView", patch: { name: "Renamed" } },
    { type: "arrange", patch: { sort: [{ field: "title", direction: "asc" }] } },
    { type: "saveForEveryone" },
    { type: "arrange", patch: { group: { field: "status" } } },
  );
  assert.equal(changed.tables["projects/projects"]!.views[0]!.name, "Renamed");

  const cancelled = run(changed, { type: "settings", open: false, revert: true });
  assert.equal(cancelled.settingsOpen, false);
  assert.deepEqual(cancelled.tables["projects/projects"]!.views, before.tables["projects/projects"]!.views);
  assert.deepEqual(cancelled.arrangements, before.arrangements);
  assert.equal(cancelled.settingsBefore, null);

  const kept = run(changed, { type: "settings", open: false });
  assert.equal(kept.tables["projects/projects"]!.views[0]!.name, "Renamed");
  assert.deepEqual(kept.arrangements["projects/projects"]?.["v1"], { group: { field: "status" } });
  assert.equal(kept.settingsBefore, null);
});

test("Cancel after adding a view from the settings drops it and goes back to the view that was open", () => {
  const open = run(start(), { type: "settings", open: true });
  const before = open.tables["projects/projects"]!.views.length;
  const added = run(open, { type: "addView", id: "new-1" });
  assert.equal(added.tables["projects/projects"]!.views.length, before + 1);
  assert.equal(added.settingsOpen, true);

  const cancelled = run(added, { type: "settings", open: false, revert: true });
  assert.equal(cancelled.tables["projects/projects"]!.views.length, before);
  assert.equal(cancelled.viewIds["projects/projects"], open.viewIds["projects/projects"]);
});

test("Cancel on a new view's settings drops the view; Done keeps it", () => {
  const start0 = start();
  const added = run(start0, { type: "addView", id: "new-1" });
  assert.equal(added.settingsOpen, true);
  assert.equal(added.viewIds["projects/projects"], "new-1");

  const cancelled = run(added, { type: "settings", open: false, revert: true });
  assert.deepEqual(cancelled.tables["projects/projects"]!.views, start0.tables["projects/projects"]!.views);
  assert.equal(viewOf(cancelled), viewOf(start0));

  const kept = run(added, { type: "settings", open: false });
  assert.ok(kept.tables["projects/projects"]!.views.some((v) => v.id === "new-1"));
});

test("Cancel on settings opened with nothing changed changes nothing", () => {
  const open = run(start(), { type: "settings", open: true });
  const cancelled = run(open, { type: "settings", open: false, revert: true });
  assert.equal(cancelled.tables, open.tables);
  assert.deepEqual(cancelled.dirty, []);
});

test("display, the sidebar's side and collapse, and the Files side's folders and file", () => {
  let s = run(
    start(),
    { type: "display", choice: { kind: "locale", value: "ar-EG" } },
    { type: "setFilesSide", files: true },
    { type: "setSidebarCollapsed", collapsed: true },
    { type: "toggleDir", id: "crm/tables/deals", open: true },
    { type: "showFile", file: { bundle: "crm", path: "meta.json" } },
  );
  assert.equal(s.display.locale, "ar-EG");
  assert.deepEqual(s.sidebar, { files: true, collapsed: true });
  assert.deepEqual(s.openedDirs, { "crm/tables/deals": true });
  assert.deepEqual(s.shownFile, { bundle: "crm", path: "meta.json" });
  s = run(s, { type: "setFilesSide", files: false }, { type: "setSidebarCollapsed", collapsed: false });
  assert.deepEqual(s.sidebar, {});
  s = run(s, { type: "setDisplayFolded", folded: true });
  assert.deepEqual(s.sidebar, { foldedDisplay: true });
  assert.deepEqual(run(s, { type: "setDisplayFolded", folded: false }).sidebar, { foldedDisplay: false });
});

// Files in, messages, writing

function one(bundle: string): Library {
  const { tables } = examples();
  const table = { ...tables["shop/lines"]!, path: `${bundle}.table/tables/${bundle}` };
  return { tables: { [`${bundle}/${bundle}`]: table }, bundles: { [bundle]: { title: "Notes" } }, paths: {}, problems: {} };
}

test("opened: a folder is held and shown, and isn't written back until edited", () => {
  const s = run(start({ stored: { sidebar: { files: true } } }), { type: "opened", library: { ...one("notes"), paths: { notes: "/x/notes.table" } } });
  assert.equal(s.active, "notes/notes");
  assert.equal(s.sidebar.files, undefined);
  assert.deepEqual(s.opened, { notes: "/x/notes.table" });
  assert.deepEqual(s.dirty, []);
});

test("opened: an archive has no folder yet, so it's written; what was skipped is told", () => {
  const s = run(start(), { type: "opened", library: one("notes"), skipped: ["rows.ndjson line 2: bad"] });
  assert.deepEqual(s.opened, {});
  assert.deepEqual(s.dirty, ["notes"]);
  assert.deepEqual(s.telling, { heading: `Opened "Notes", but skipped 1 thing it couldn't read:`, body: "rows.ndjson line 2: bad" });
  assert.equal(run(s, { type: "told" }).telling, null);
});

test("tell shows a message until told", () => {
  const s = run(start(), { type: "tell", message: { heading: "Couldn't open x.zip: bad" } });
  assert.deepEqual(s.telling, { heading: "Couldn't open x.zip: bad" });
});

test("written clears what was written, but not a bundle edited again meanwhile", () => {
  const edited = run(start(), { type: "updateRow", rowId: "p1", field: "title", value: "A" }, { type: "showTable", key: "crm/deals" }, { type: "updateRow", rowId: "dl-1", field: "title", value: "B" });
  assert.deepEqual(edited.dirty, ["projects", "crm"]);
  const snapshot = edited.tables;
  const again = run(edited, { type: "updateRow", rowId: "dl-1", field: "title", value: "C" });
  const s = run(again, { type: "written", bundles: ["projects", "crm"], tables: snapshot });
  assert.deepEqual(s.dirty, ["crm"]);
  assert.deepEqual(run(s, { type: "written", bundles: ["crm"] }).dirty, []);
});

// Selectors

test("derive: the view on screen as this viewer sees it, with its summary and breadcrumb", () => {
  const s = run(start(), { type: "showView", key: "crm/deals", viewId: "all" }, { type: "search", text: "zzzz-nothing" });
  const d = derive(s, { locale: "en-GB" });
  assert.equal(d.table, s.tables["crm/deals"]);
  assert.equal(d.view.id, "all");
  assert.equal(d.shown.rows.length, 0);
  assert.equal(d.summary.count, "0 of 8 matching");
  assert.equal(d.breadcrumb.text, "CRM (crm.table) › Deals");
  assert.equal(d.direction, "ltr");
  assert.equal(d.mode, "tables");
  assert.deepEqual(d.filesTree, []);
});

test("derive: a search of only spaces isn't searching", () => {
  const d = derive(run(start(), { type: "showView", key: "crm/deals", viewId: "all" }, { type: "search", text: "  " }));
  assert.equal(d.summary.count, "8 of 8 rows");
});

test("derive: the viewer's language sets the direction; the platform's when they chose none", () => {
  assert.equal(derive(start(), { locale: "he-IL" }).direction, "rtl");
  assert.equal(derive(run(start(), { type: "display", choice: { kind: "locale", value: "en-US" } }), { locale: "he-IL" }).direction, "ltr");
});

test("derive: the sidebar expands the table on screen and marks its view", () => {
  const d = derive(run(start(), { type: "showView", key: "crm/deals", viewId: "open" }));
  const views = d.sidebarEntries.filter((e) => e.kind === "view");
  assert.ok(views.every((e) => e.key === "crm/deals"));
  assert.deepEqual(views.filter((e) => e.view.active).map((e) => e.view.id), ["open"]);
});

test("derive: the Files side's tree, only on that side", () => {
  const d = derive(run(start(), { type: "setFilesSide", files: true }), { attachmentsOf: () => ["a.png"] });
  assert.equal(d.mode, "files");
  assert.deepEqual(d.filesTree.map((b) => b.bundle), Object.keys(examples().bundles));
});

test("derive: commands say what's possible, and the address names the open page", () => {
  const s = run(start(), { type: "setSidebarCollapsed", collapsed: true }, { type: "showTable", key: "crm/deals" }, { type: "openPage", rowId: "dl-1" });
  const d = derive(s);
  const byId = Object.fromEntries(d.commands.map((c) => [c.id, c]));
  assert.equal(byId["toggle-sidebar"]!.label, "Show Sidebar");
  assert.equal(byId["go-back"]!.enabled, true);
  assert.equal(byId["go-forward"]!.enabled, false);
  assert.equal(d.address, viewAddress("crm/deals", "pipeline", "dl-1"));
});

test("derive: schema changed since opened", () => {
  const s = run(start(), { type: "addField", field: { name: "extra", type: "string" } });
  assert.equal(derive(start()).summary.schemaChanged, false);
  assert.equal(derive(s).summary.schemaChanged, true);
});

test("viewCallbacks dispatch the named actions, with the adapter's ids", () => {
  const seen: AppAction[] = [];
  let n = 0;
  const cb = viewCallbacks(start(), (a) => seen.push(a), () => `id-${++n}`);
  assert.equal(cb.onAddRow(), "id-1");
  cb.onInsertRow("p1", "below");
  cb.onDeleteRow("p1");
  cb.onOpenBody("p10");
  cb.onOpenRelation(viewAddress("crm/deals", "all"));
  cb.onOpenRelation("nowhere.table");
  cb.onAddEnumValue("status", "New");
  assert.deepEqual(seen, [
    { type: "addRow", id: "id-1" },
    { type: "insertRow", anchor: "p1", where: "below", id: "id-2" },
    { type: "deleteRow", rowId: "p1" },
    { type: "openPage", rowId: "p10" },
    { type: "follow", target: { key: "crm/deals", viewId: "all", openBody: null } },
    { type: "addChoice", name: "status", value: "New" },
  ]);
});
