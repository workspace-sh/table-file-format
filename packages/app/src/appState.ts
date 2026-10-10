// Everything an app around the .table views holds, and every change to it,
// as one reducer (docs/APP-STATE.md): which table and view are on screen,
// the tables themselves and the edits made to them, this viewer's own
// arrangements and settings, and the questions to ask before a change
// that can't be undone. Pure, as the rest of table-app is: no React, no
// renderer, no storage. Each app draws what `derive` gives it, shows
// `asking` and `telling` its own way, and writes the bundles in `dirty`.

import { isSheet, textDirection, type Address, type BundleMeta, type Field, type ParsedTable, type TableSchema, type View } from "@workspace.sh/table-core";
import { canInsertAt, type DisplaySettingKind, type DisplaySettings, type ViewProps } from "@workspace.sh/table-ui/shared";

import { arrange, arrangedView, isArranged, reset as resetArrangement, savingForEveryone, type Arrangement, type Arrangements } from "./arrangements.ts";
import { tableBreadcrumb, type Breadcrumb } from "./breadcrumb.ts";
import { addressTarget, applyTarget, bundleOf, type AddressTarget } from "./bundles.ts";
import { appCommands, type AppCommand } from "./commands.ts";
import { CANCEL, type Confirm } from "./confirm.ts";
import { creating, namePrompt, newView, type Making, type NamePrompt } from "./creating.ts";
import { viewerLocale, viewerOrder, withDisplayChoice } from "./displaySettings.ts";
import {
  deletingField,
  deletingRow,
  deletingView,
  removingChoice,
  withoutChoice,
  withoutField,
  onTable,
  viewPatchPrompt,
  withBody,
  withCell,
  withChoice,
  withField,
  withFieldMoved,
  withFieldPatch,
  withoutRow,
  withoutView,
  withRow,
  withRowAt,
  withView,
  withViewPatch,
} from "./edits.ts";
import { filesTree, type FilesTreeBundle } from "./filesTree.ts";
import { addressLive, goBack, goForward, NO_HISTORY, viewAddress, visited, type History, type Place } from "./history.ts";
import { leaving } from "./leaving.ts";
import type { Library } from "./library.ts";
import { afterReset, resetPrompt } from "./resetting.ts";
import { showView, type ShownView } from "./showView.ts";
import { flattenSidebar, sidebarTree, type SidebarBundle, type SidebarEntry } from "./sidebar.ts";
import { withFileToggled, withFileUnfolded, type SidebarPrefs } from "./sidebarPrefs.ts";
import { firstTableKey, firstViews, NO_TABLE } from "./starting.ts";
import { skippedText } from "./tableFiles.ts";
import { schemaVersions, viewSummary, type ViewSummary } from "./viewSummary.ts";

/** A file shown from the Files side: its bundle, and its path inside `<bundle>.table/`. */
export interface ShownFile {
  bundle: string;
  path: string;
}

/** What answering the question does, as data. */
export type Pending =
  | { type: "deleteRow"; key: string; rowId: string }
  | { type: "deleteField"; key: string; name: string }
  | { type: "removeChoice"; key: string; name: string; value: string }
  | { type: "deleteView"; key: string; viewId: string; nextViewId: string }
  | { type: "updateView"; key: string; viewId: string; patch: Partial<View> }
  | { type: "reset"; fresh: Library }
  | { type: "create"; making: Making };

/** A question waiting for its answer: a Confirm, or a name to type. */
export type Asking = { kind: "confirm"; confirm: Confirm; on: Pending } | { kind: "name"; prompt: NamePrompt; on: Pending };

/** A message to show once, with nothing to answer. */
export interface Telling {
  heading: string;
  body?: string;
}

/** What the view settings can change, as it was when they opened. */
export interface SettingsBefore {
  key: string;
  viewId: string;
  views: View[];
  /** This viewer's own arrangements of the table's views. */
  arrangements: Arrangements[string] | undefined;
}

export interface AppState {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  /** The table on screen, by `bundle/table` key: always a held table while there is one. */
  active: string;
  /** Each table's view. */
  viewIds: Record<string, string>;
  /** The row whose page is open, in `active`. */
  openPage: string | null;
  /** Each bundle opened from a folder, and where: opaque here, the app's to use. A reset keeps these. */
  opened: Record<string, string>;
  /** Each table's schema-version when it was opened, for "schema changed" (D22). */
  openedAt: Record<string, number>;
  /** The file shown from the Files side (`sidebar.files`). */
  shownFile: ShownFile | null;
  /** Folders on the Files side the viewer opened or closed, by `bundle/path`. */
  openedDirs: Record<string, boolean>;
  sidebar: SidebarPrefs;
  history: History;
  /**
   * Where you are in the view on screen, as the view and the app report it
   * (the cell selected, how far down): kept with the view in history as
   * it's left. The page open and the search are their own fields.
   */
  place: Place;
  /**
   * A place handed back by going back or forward, for the view and the app
   * to put back (select the cell, scroll to the row). `n` counts each one,
   * so the same place twice is still news.
   */
  restoring: { place: Place; n: number } | null;
  arrangements: Arrangements;
  display: DisplaySettings;
  search: string;
  settingsOpen: boolean;
  /** The view settings' table as they opened, for Cancel to put back. */
  settingsBefore: SettingsBefore | null;
  asking: Asking | null;
  telling: Telling | null;
  /** Bundles edited since they were last written. */
  dirty: string[];
  /**
   * Edits to rows of tables held in the index (`ParsedTable.indexed`),
   * in order, for the app to make there: their rows aren't in `tables`
   * to change. Each goes once the app says it's made (`indexed`).
   */
  indexWork: IndexWork[];
  /**
   * What undo puts back, for each table: the table as it was before each
   * edit to its rows, its fields or its views, newest last, and what redo
   * puts back after an undo. Where you are (the cell selected, the view,
   * the page open) isn't an edit, and isn't here.
   */
  undo: Record<string, { past: UndoStep[]; future: UndoStep[] }>;
}

/** A table as it was before an edit. `run` is given to edits that are one stretch of the same thing (typing in a page), which undo as one. */
export interface UndoStep {
  table: ParsedTable;
  run?: string;
}

/** The most steps kept for a table, the fewest, and the rows those steps may list between them. */
const UNDO_STEPS = 100;
const UNDO_FEWEST = 20;
const UNDO_ROWS = 2_000_000;

/** One edit to a row of an indexed table; `n` counts them. */
export type IndexWork = { n: number; key: string } & (
  | { kind: "cell"; rowId: string; field: string; value: unknown }
  | { kind: "add"; rowId: string }
  | { kind: "remove"; rowId: string }
  | { kind: "body"; rowId: string; content: string }
);

/** One of the Display controls' choices. */
export interface DisplayChoice {
  kind: DisplaySettingKind;
  value: string;
}

export type AppAction =
  // Where you are
  | { type: "showTable"; key: string }
  | { type: "showView"; key: string; viewId: string }
  | { type: "follow"; target: AddressTarget }
  | { type: "back" }
  | { type: "forward" }
  | { type: "openPage"; rowId: string | null }
  /** The view or the app reporting where you are in the view on screen. */
  | { type: "place"; place: Pick<Place, "rowId" | "field" | "top"> }
  | { type: "search"; text: string }
  // `revert`: closing by Cancel, which puts back everything the settings
  // changed since they opened (the views, saved for everyone or not, and
  // this viewer's own arrangements).
  | { type: "settings"; open: boolean; revert?: boolean }
  // Edits to the view on screen: ViewProps' callbacks, one to one
  | { type: "updateRow"; rowId: string; field: string; value: unknown }
  | { type: "addRow"; id: string }
  | { type: "insertRow"; anchor: string; where: "above" | "below"; id: string }
  | { type: "deleteRow"; rowId: string }
  // `table`: the table it's in, when that may no longer be the one on
  // screen (a page saved as it's typed, its last save landing after a move).
  | { type: "updateBody"; rowId: string; content: string; table?: string }
  | { type: "updateField"; name: string; patch: Partial<Field> }
  | { type: "addField"; field: Field }
  | { type: "moveField"; name: string; delta: -1 | 1 }
  // A field's settings, cancelled: the schema as they opened, version and all.
  | { type: "restoreSchema"; schema: TableSchema }
  | { type: "addChoice"; name: string; value: string }
  | { type: "removeChoice"; name: string; value: string }
  | { type: "deleteField"; name: string }
  | { type: "updateView"; patch: Partial<View> }
  | { type: "addView"; id: string }
  | { type: "deleteView" }
  // This viewer's own
  | { type: "arrange"; patch: Partial<View> }
  | { type: "saveForEveryone" }
  | { type: "resetArrangement" }
  | { type: "display"; choice: DisplayChoice }
  | { type: "setFilesSide"; files: boolean }
  | { type: "toggleFile"; bundle: string }
  | { type: "setSidebarCollapsed"; collapsed: boolean }
  | { type: "setDisplayFolded"; folded: boolean }
  | { type: "showFile"; file: ShownFile | null }
  | { type: "toggleDir"; id: string; open: boolean }
  // Files, and questions
  | { type: "create"; making: Making }
  | { type: "opened"; library: Library; skipped?: string[] }
  | { type: "reset"; fresh: Library }
  | { type: "answer"; response: string; text?: string }
  | { type: "tell"; message: Telling }
  | { type: "told" }
  | { type: "written"; bundles: string[]; tables?: Record<string, ParsedTable> }
  /**
   * An indexed table's rows as they now are: how many, after a build or
   * after the edits up to `done` (an IndexWork's `n`) were made, which
   * then leave the queue and the table is to be written.
   */
  /** Put the table on screen back as it was before its last edit; and forward again. */
  | { type: "undo" }
  | { type: "redo" }
  | { type: "indexed"; key: string; count: number; done?: number }
  /** A table read again, to hold in place of the one held: an indexed table whose index couldn't be made, now in memory. */
  | { type: "reloaded"; key: string; table: ParsedTable };

/** The viewer's own settings, as the app loaded them from its store. */
export interface StoredPrefs {
  sidebar?: SidebarPrefs;
  arrangements?: Arrangements;
  display?: DisplaySettings;
}

export interface AppStart {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  /** Bundles opened from folders, and where. */
  opened?: Record<string, string>;
  stored?: StoredPrefs;
  /** Where to open: an address, as a link or the page's own address gives it. */
  start?: Address | string;
}

export function initialAppState(input: AppStart): AppState {
  const { tables, bundles } = input;
  const base: AppState = {
    tables,
    bundles,
    active: firstTableKey(tables) ?? "",
    viewIds: firstViews(tables),
    openPage: null,
    opened: input.opened ?? {},
    openedAt: schemaVersions(tables),
    shownFile: null,
    openedDirs: {},
    sidebar: input.stored?.sidebar ?? {},
    history: NO_HISTORY,
    place: {},
    restoring: null,
    arrangements: input.stored?.arrangements ?? {},
    display: input.stored?.display ?? {},
    search: "",
    settingsOpen: false,
    settingsBefore: null,
    asking: null,
    telling: null,
    dirty: [],
    indexWork: [],
    undo: {},
  };
  const target = input.start ? addressTarget(input.start, tables, bundles, "") : null;
  const state = target ? follow(base, target) : base;
  return {
    ...state,
    sidebar: withFileUnfolded(state.sidebar, bundleOf(state.active)),
    history: visited(state.history, viewAddress(state.active, viewIdOf(state, state.active))),
  };
}

/** The id of the view shown for the table under `key`: its chosen view while it's there, else its first. */
export function viewIdOf(state: Pick<AppState, "tables" | "viewIds">, key: string): string {
  const views = state.tables[key]?.views ?? [];
  const chosen = state.viewIds[key];
  return views.some((v) => v.id === chosen) ? chosen! : (views[0]?.id ?? "");
}

export function tableApp(state: AppState, action: AppAction): AppState {
  const next = step(state, action);
  return next === state ? state : settle(state, next, action);
}

// The four rules, after every action: the table on screen is a held one;
// leaving a view clears its search and closes its settings (a new view
// opens on its settings); the view on screen is recorded in history; and
// the file of the table on screen unfolds.
function settle(prev: AppState, state: AppState, action: AppAction): AppState {
  let next = state;
  if (!next.tables[next.active]) next = { ...next, active: firstTableKey(next.tables) ?? next.active };
  const tableChanged = next.active !== prev.active;
  // A page open is of a row in the table on screen: it closes when the row
  // goes, or when another table shows, unless following an address opened it
  // (row ids are only unique within a table).
  if (
    next.openPage !== null &&
    ((tableChanged && action.type !== "follow") || !next.tables[next.active]?.rows.some((r) => r.id === next.openPage))
  ) {
    next = { ...next, openPage: null };
  }
  const fromView = viewIdOf(prev, prev.active);
  const toView = viewIdOf(next, next.active);
  const left = leaving(prev.active, fromView, next.active, toView);
  if (left.clearSearch && next.search !== "") next = { ...next, search: "" };
  if (left.closeSettings && next.settingsOpen && action.type !== "addView") next = { ...next, settingsOpen: false };
  if (next.settingsOpen && !prev.settingsOpen) {
    // A new view opens on its settings: Cancel there drops it, as a new
    // thing's sheet does, so what's kept is from before it was added.
    const key = next.active;
    const from = action.type === "addView" ? prev : next;
    next = {
      ...next,
      settingsBefore: { key, viewId: viewIdOf(from, key), views: from.tables[key]?.views ?? [], arrangements: from.arrangements[key] },
    };
  } else if (!next.settingsOpen && next.settingsBefore) next = { ...next, settingsBefore: null };
  if (tableChanged) next = { ...next, sidebar: withFileUnfolded(next.sidebar, bundleOf(next.active)) };
  if (next.tables[next.active]) {
    const history = visited(next.history, viewAddress(next.active, toView), placeOf(prev));
    // A view arrived at afresh starts at its top; one gone back or forward to, where it was left.
    if (history !== next.history) next = { ...next, history, place: {} };
  }
  if ((action.type === "back" || action.type === "forward") && next.restoring && next.restoring !== prev.restoring) {
    const { place } = next.restoring;
    const rows = next.tables[next.active]?.rows ?? [];
    next = {
      ...next,
      place: { ...(place.rowId ? { rowId: place.rowId, field: place.field } : {}), ...(place.top ? { top: place.top } : {}) },
      search: place.search ?? "",
      openPage: place.page && rows.some((r) => r.id === place.page) ? place.page : null,
    };
  }
  return next;
}

/** Where you are in the view on screen, all of it: what history keeps as it's left. */
function placeOf(state: AppState): Place {
  return {
    ...state.place,
    ...(state.openPage ? { page: state.openPage } : {}),
    ...(state.search ? { search: state.search } : {}),
  };
}

/** An edit to the table on screen: made, and its bundle marked to write. Nothing when it changes nothing. */
/**
 * An edit to a table: made, the table to be written, and what it was
 * before kept for undo. `run` names a stretch of edits that undo as one
 * (each save of the same page while it's typed in).
 *
 * A table held in the index has its rows there, not here, so only an edit
 * to its views is kept; an edit to its fields changes what the index
 * holds, and what was kept before it is let go.
 */
function edit(state: AppState, change: (table: ParsedTable) => ParsedTable, key = state.active, run?: string): AppState {
  const tables = onTable(state.tables, key, change);
  if (tables === state.tables) return state;
  const next = { ...state, tables, dirty: marked(state.dirty, bundleOf(key)) };
  const before = state.tables[key]!;
  if (before.indexed) {
    const after = tables[key]!;
    if (after.schema !== before.schema) return { ...next, undo: without(state.undo, [key]) };
    if (after.views === before.views) return next;
  }
  const stack = state.undo[key] ?? { past: [], future: [] };
  const last = stack.past.at(-1);
  // Another edit of the same stretch: the step already kept is where undo goes back to.
  const past =
    run !== undefined && last?.run === run
      ? stack.past
      : [...stack.past, { table: before, ...(run !== undefined ? { run } : {}) }].slice(-stepsKept(before));
  return { ...next, undo: { ...state.undo, [key]: { past, future: [] } } };
}

/** How many steps a table keeps: fewer for a long one, each of whose row edits keeps a list of every row. */
function stepsKept(table: ParsedTable): number {
  return Math.max(UNDO_FEWEST, Math.min(UNDO_STEPS, Math.floor(UNDO_ROWS / Math.max(1, table.rows.length))));
}

function without<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (!keys.some((k) => k in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k)));
}

/** Undo or redo on the table on screen: the table from one stack put back, and the one it replaces put on the other. */
function stepBack(state: AppState, from: "past" | "future"): AppState {
  const key = state.active;
  const now = state.tables[key];
  const stack = state.undo[key];
  const step = stack?.[from].at(-1);
  if (!now || !stack || !step || state.sidebar.files) return state;
  const to = from === "past" ? "future" : "past";
  // A table held in the index: its views go back, and the rest stays what the index holds.
  const table = now.indexed ? { ...now, views: step.table.views } : step.table;
  return {
    ...state,
    tables: { ...state.tables, [key]: table },
    dirty: marked(state.dirty, bundleOf(key)),
    undo: {
      ...state.undo,
      [key]: { ...stack, [from]: stack[from].slice(0, -1), [to]: [...stack[to], { table: now, ...(step.run !== undefined ? { run: step.run } : {}) }] },
    },
  };
}

/** A stretch of edits is over (the page being typed in was closed): the next edit like it is its own step. */
function runEnded(state: AppState, key: string): AppState {
  const stack = state.undo[key];
  const last = stack?.past.at(-1);
  if (!stack || last?.run === undefined) return state;
  return { ...state, undo: { ...state.undo, [key]: { ...stack, past: [...stack.past.slice(0, -1), { table: last.table }] } } };
}

/** An edit to an indexed table's row, for the app to make in the index. */
function queued(state: AppState, work: IndexWork extends infer W ? (W extends { n: number } ? Omit<W, "n"> : never) : never): AppState {
  const n = (state.indexWork.at(-1)?.n ?? 0) + 1;
  return { ...state, indexWork: [...state.indexWork, { ...work, n } as IndexWork] };
}

/** A page of an indexed table's row, whose rows aren't here to check it against. */
function withIndexedBody(table: ParsedTable, rowId: string, content: string): ParsedTable {
  if ((table.bodies?.[rowId] ?? "") === content) return table;
  const bodies = { ...(table.bodies ?? {}) };
  if (content.length === 0) delete bodies[rowId];
  else bodies[rowId] = content;
  return { ...table, bodies };
}

function marked(dirty: string[], bundle: string): string[] {
  return dirty.includes(bundle) ? dirty : [...dirty, bundle];
}

function follow(state: AppState, target: AddressTarget): AppState {
  const applied = applyTarget(target, state);
  return {
    ...state,
    active: applied.activeKey,
    viewIds: applied.viewIds,
    openPage: applied.openBody,
    sidebar: tablesSide(state.sidebar),
  };
}

/** The prefs on the Tables side: no `files` key, as a stored default is absent. */
function tablesSide(prefs: SidebarPrefs): SidebarPrefs {
  if (!prefs.files) return prefs;
  const { files: _files, ...rest } = prefs;
  return rest;
}

function moved(state: AppState, to: { history: History; address: string; place?: Place } | null): AppState {
  if (!to) return state;
  const target = addressTarget(to.address, state.tables, state.bundles, bundleOf(state.active));
  if (!target) return state;
  // The place the view was left at comes back with it (settle puts it in place).
  return { ...follow(state, target), history: to.history, restoring: { place: to.place ?? {}, n: (state.restoring?.n ?? 0) + 1 } };
}

function currentView(state: AppState): View | undefined {
  const id = viewIdOf(state, state.active);
  return state.tables[state.active]?.views.find((v) => v.id === id);
}

/** Show what was made or opened, on the Tables side. A page open elsewhere closes (settle's rule). */
function show(state: AppState, key: string | undefined, viewId?: string): AppState {
  if (!key) return state;
  return {
    ...state,
    active: key,
    viewIds: viewId ? { ...state.viewIds, [key]: viewId } : state.viewIds,
    sidebar: tablesSide(state.sidebar),
  };
}

function step(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "showTable":
      if (!state.tables[action.key]) return state;
      return { ...state, active: action.key, openPage: null };
    case "showView":
      if (!state.tables[action.key]?.views.some((v) => v.id === action.viewId)) return state;
      return { ...state, active: action.key, viewIds: { ...state.viewIds, [action.key]: action.viewId }, openPage: null };
    case "follow":
      return state.tables[action.target.key] ? follow(state, action.target) : state;
    case "back":
      return moved(state, goBack(state.history, (a) => addressLive(a, state.tables, state.bundles), placeOf(state)));
    case "forward":
      return moved(state, goForward(state.history, (a) => addressLive(a, state.tables, state.bundles), placeOf(state)));
    case "place": {
      const place = { ...state.place, ...action.place };
      for (const k of Object.keys(place) as (keyof Place)[]) if (place[k] === undefined) delete place[k];
      return JSON.stringify(place) === JSON.stringify(state.place) ? state : { ...state, place };
    }
    case "openPage":
      if (action.rowId !== null && !state.tables[state.active]?.rows.some((r) => r.id === action.rowId)) return state;
      return action.rowId === state.openPage ? state : { ...runEnded(state, state.active), openPage: action.rowId };
    case "search":
      return action.text === state.search ? state : { ...state, search: action.text };
    case "settings": {
      if (action.open === state.settingsOpen) return state;
      const before = state.settingsBefore;
      if (action.open || !action.revert || !before || !state.tables[before.key]) return { ...state, settingsOpen: action.open };
      const reverted = edit(state, (t) => (t.views === before.views ? t : { ...t, views: before.views }), before.key);
      const { [before.key]: _, ...others } = state.arrangements;
      return {
        ...reverted,
        arrangements: before.arrangements ? { ...others, [before.key]: before.arrangements } : others,
        viewIds: { ...reverted.viewIds, [before.key]: before.viewId },
        settingsOpen: false,
      };
    }

    case "updateRow":
      if (state.tables[state.active]?.indexed) return queued(state, { key: state.active, kind: "cell", rowId: action.rowId, field: action.field, value: action.value });
      return edit(state, (t) => withCell(t, action.rowId, action.field, action.value));
    case "addRow":
      if (state.tables[state.active]?.indexed) return queued(state, { key: state.active, kind: "add", rowId: action.id });
      return edit(state, (t) => withRow(t, action.id));
    case "insertRow": {
      // Only in a Sheet view whose order isn't decided by a sort (D41).
      const view = currentView(state);
      if (!view || !isSheet(view) || !canInsertAt(view)) return state;
      return edit(state, (t) => withRowAt(t, view.id, action.anchor, action.where, action.id));
    }
    case "deleteRow": {
      const table = state.tables[state.active];
      if (!table || (!table.indexed && !table.rows.some((r) => r.id === action.rowId))) return state;
      const { prompt } = deletingRow(table, action.rowId, state.openPage);
      return { ...state, asking: { kind: "confirm", confirm: prompt, on: { type: "deleteRow", key: state.active, rowId: action.rowId } } };
    }
    case "updateBody": {
      const key = action.table ?? state.active;
      if (state.tables[key]?.indexed) {
        // The page is held here; the index hears of it for its search.
        const held = edit(state, (t) => withIndexedBody(t, action.rowId, action.content), key);
        return held === state ? state : queued(held, { key, kind: "body", rowId: action.rowId, content: action.content });
      }
      // Each save of a page while it's typed in is one stretch: undo takes it back whole.
      return edit(state, (t) => withBody(t, action.rowId, action.content), action.table, `page:${action.rowId}`);
    }
    case "updateField":
      return edit(state, (t) => withFieldPatch(t, action.name, action.patch));
    case "addField":
      return edit(state, (t) => withField(t, action.field, viewIdOf(state, state.active)));
    case "moveField":
      return edit(state, (t) => withFieldMoved(t, action.name, action.delta));
    case "restoreSchema":
      return edit(state, (t) => (t.schema === action.schema ? t : { ...t, schema: action.schema }));
    case "addChoice":
      return edit(state, (t) => withChoice(t, action.name, action.value));
    case "removeChoice": {
      // Rows that hold it lose it, so ask first; none hold it, it just goes.
      const table = state.tables[state.active];
      if (!table) return state;
      const prompt = removingChoice(table, action.name, action.value);
      if (!prompt) return edit(state, (t) => withoutChoice(t, action.name, action.value));
      return { ...state, asking: { kind: "confirm", confirm: prompt, on: { type: "removeChoice", key: state.active, name: action.name, value: action.value } } };
    }
    case "deleteField": {
      const table = state.tables[state.active];
      if (!table?.schema.fields.some((f) => f.name === action.name)) return state;
      return { ...state, asking: { kind: "confirm", confirm: deletingField(table, action.name), on: { type: "deleteField", key: state.active, name: action.name } } };
    }
    case "updateView": {
      const view = currentView(state);
      if (!view) return state;
      const prompt = viewPatchPrompt(state.tables, state.active, view, action.patch);
      if (prompt) {
        return { ...state, asking: { kind: "confirm", confirm: prompt, on: { type: "updateView", key: state.active, viewId: view.id, patch: action.patch } } };
      }
      return edit(state, (t) => withViewPatch(t, view.id, action.patch));
    }
    case "addView": {
      // A plain table of everything; its settings open, where it's made into what's wanted.
      const edited = edit(state, (t) => withView(t, newView(action.id)));
      if (edited === state) return state;
      return { ...edited, viewIds: { ...edited.viewIds, [state.active]: action.id }, settingsOpen: true };
    }
    case "deleteView": {
      const view = currentView(state);
      const deleting = view ? deletingView(state.tables, state.active, view) : null;
      if (!view || !deleting) return state;
      return {
        ...state,
        asking: { kind: "confirm", confirm: deleting.prompt, on: { type: "deleteView", key: state.active, viewId: view.id, nextViewId: deleting.nextViewId } },
      };
    }

    case "arrange": {
      const view = currentView(state);
      return view ? { ...state, arrangements: arrange(state.arrangements, state.active, view.id, action.patch) } : state;
    }
    case "saveForEveryone": {
      const view = currentView(state);
      if (!view || !isArranged(state.arrangements[state.active]?.[view.id])) return state;
      const saving = savingForEveryone(state.arrangements, state.active, view.id);
      return { ...edit(state, (t) => withViewPatch(t, view.id, saving.patch)), arrangements: saving.arrangements };
    }
    case "resetArrangement": {
      const view = currentView(state);
      const arrangements = view ? resetArrangement(state.arrangements, state.active, view.id) : state.arrangements;
      return arrangements === state.arrangements ? state : { ...state, arrangements };
    }
    case "display":
      return { ...state, display: withDisplayChoice(state.display, action.choice.kind, action.choice.value) };
    case "setFilesSide":
      if (!!state.sidebar.files === action.files) return state;
      return { ...state, sidebar: action.files ? { ...state.sidebar, files: true } : tablesSide(state.sidebar) };
    case "toggleFile":
      return { ...state, sidebar: withFileToggled(state.sidebar, action.bundle) };
    case "setSidebarCollapsed": {
      if (!!state.sidebar.collapsed === action.collapsed) return state;
      const { collapsed: _collapsed, ...rest } = state.sidebar;
      return { ...state, sidebar: action.collapsed ? { ...rest, collapsed: true } : rest };
    }
    case "setDisplayFolded": {
      if (!!state.sidebar.foldedDisplay === action.folded) return state;
      return { ...state, sidebar: { ...state.sidebar, foldedDisplay: action.folded } };
    }
    case "showFile":
      return { ...state, shownFile: action.file };
    case "toggleDir":
      return { ...state, openedDirs: { ...state.openedDirs, [action.id]: action.open } };

    case "create":
      return { ...state, asking: { kind: "name", prompt: namePrompt(action.making, state.bundles), on: { type: "create", making: action.making } } };
    case "opened": {
      const { library } = action;
      const keys = Object.keys(library.bundles);
      if (keys.length === 0) return state;
      // A bundle with no folder it came from (an archive) isn't kept anywhere yet, so it's written.
      const unkept = keys.filter((b) => library.paths[b] === undefined);
      const title = keys.length === 1 ? (library.bundles[keys[0]!]?.title ?? keys[0]!) : `${keys.length} files`;
      const told = action.skipped ? skippedText(title, action.skipped) : null;
      return show(
        {
          ...state,
          tables: { ...state.tables, ...library.tables },
          undo: without(state.undo, Object.keys(library.tables)),
          bundles: { ...state.bundles, ...library.bundles },
          opened: { ...state.opened, ...library.paths },
          openedAt: { ...state.openedAt, ...schemaVersions(library.tables) },
          viewIds: { ...firstViews(library.tables), ...state.viewIds },
          dirty: unkept.reduce(marked, state.dirty),
          ...(told ? { telling: told } : {}),
        },
        firstTableKey(library.tables),
      );
    }
    case "reset":
      return {
        ...state,
        asking: {
          kind: "confirm",
          confirm: resetPrompt({ openedFolders: Object.keys(state.opened).length > 0 }),
          on: { type: "reset", fresh: action.fresh },
        },
      };
    case "answer":
      return state.asking ? answered({ ...state, asking: null }, state.asking, action) : state;
    case "tell":
      return { ...state, telling: action.message };
    case "told":
      return state.telling ? { ...state, telling: null } : state;
    case "written": {
      // A bundle edited again while it was being written stays to write.
      const since = action.tables;
      const stale = (b: string) => since !== undefined && Object.keys(state.tables).some((k) => bundleOf(k) === b && state.tables[k] !== since[k]);
      const dirty = state.dirty.filter((b) => !action.bundles.includes(b) || stale(b));
      return dirty.length === state.dirty.length ? state : { ...state, dirty };
    }
    case "reloaded":
      if (!state.tables[action.key]) return state;
      return {
        ...state,
        tables: { ...state.tables, [action.key]: action.table },
        indexWork: state.indexWork.filter((w) => w.key !== action.key),
        undo: without(state.undo, [action.key]),
      };
    case "undo":
      return stepBack(state, "past");
    case "redo":
      return stepBack(state, "future");
    case "indexed": {
      const table = state.tables[action.key];
      if (!table) return state;
      const indexed = { count: action.count, version: (table.indexed?.version ?? 0) + 1 };
      const tables = { ...state.tables, [action.key]: { ...table, indexed } };
      // Its rows have just gone to the index: the steps kept list them as they were here.
      if (action.done === undefined) return { ...state, tables, undo: table.indexed ? state.undo : without(state.undo, [action.key]) };
      const done = action.done;
      return {
        ...state,
        tables,
        indexWork: state.indexWork.filter((w) => w.key !== action.key || w.n > done),
        dirty: marked(state.dirty, bundleOf(action.key)),
      };
    }
  }
}

function answered(state: AppState, asking: Asking, action: { response: string; text?: string }): AppState {
  const on = asking.on;
  if (action.response === CANCEL.id) return state;
  if (asking.kind === "confirm" && !asking.confirm.responses.some((r) => r.id === action.response)) return state;
  switch (on.type) {
    case "deleteRow":
      // Its page, if open, goes with it (settle's rule).
      if (state.tables[on.key]?.indexed) return queued(edit(state, (t) => withoutRow(t, on.rowId), on.key), { key: on.key, kind: "remove", rowId: on.rowId });
      return edit(state, (t) => withoutRow(t, on.rowId), on.key);
    case "deleteField":
      return edit(state, (t) => withoutField(t, on.name), on.key);
    case "removeChoice":
      return edit(state, (t) => withoutChoice(t, on.name, on.value), on.key);
    case "deleteView": {
      const edited = edit(state, (t) => withoutView(t, on.viewId), on.key);
      if (edited === state) return state;
      // The next view shows, where this one was showing.
      return viewIdOf(state, on.key) === on.viewId
        ? { ...edited, viewIds: { ...edited.viewIds, [on.key]: on.nextViewId } }
        : edited;
    }
    case "updateView":
      return edit(state, (t) => withViewPatch(t, on.viewId, on.patch), on.key);
    case "reset": {
      const keep = Object.keys(state.opened);
      const after = afterReset(state.tables, state.bundles, on.fresh, keep);
      return show(
        {
          ...state,
          tables: after.tables,
          undo: {},
          bundles: after.bundles,
          openedAt: schemaVersions(after.tables),
          viewIds: firstViews(after.tables),
          history: NO_HISTORY,
          place: {},
          restoring: null,
          shownFile: null,
          dirty: state.dirty.filter((b) => keep.includes(b)),
        },
        firstTableKey(on.fresh.tables),
      );
    }
    case "create": {
      const made = creating(state.tables, state.bundles, on.making, action.text);
      if (!made) return state;
      return show(
        { ...state, tables: made.tables, bundles: made.bundles, dirty: marked(state.dirty, bundleOf(made.key)) },
        made.key,
        made.viewId,
      );
    }
  }
}

export interface DeriveOptions {
  /** The platform's own locale (the browser's, the system's), when the viewer hasn't chosen one. */
  locale?: string;
  /** Where "+ New table" is offered in the sidebar; `sidebarTree`'s option. */
  newTableIn?: "active" | "every" | "none";
  /** A table's attachment file names, for the Files side. */
  attachmentsOf?: (tableKey: string) => string[];
  /** What a bundle's file is called where it is (an opened folder's own name), for the breadcrumb. */
  fileNameOf?: (bundle: string) => string | undefined;
  /** For a table held in the index: how many rows its view shows now, and before the search, once the app has read them. */
  indexedShown?: { count: number; inView: number };
}

/** What the drawing needs, from the state. */
export interface Derived {
  table: ParsedTable;
  /** The view on screen, as saved. */
  view: View;
  /** This viewer's arrangement of it, and whether they have one. */
  arrangement: Arrangement | undefined;
  arranged: boolean;
  /** The view as shown: arranged, its rows filtered, sorted and searched. */
  shown: ShownView;
  summary: ViewSummary;
  breadcrumb: Breadcrumb;
  mode: "tables" | "files";
  /** The viewer's language, and which way the interface reads (D40). */
  locale: string | undefined;
  direction: "ltr" | "rtl";
  sidebarTree: SidebarBundle[];
  sidebarEntries: SidebarEntry[];
  /** The Files side's tree; empty on the Tables side. */
  filesTree: FilesTreeBundle[];
  canGoBack: boolean;
  canGoForward: boolean;
  /** Whether the table on screen has an edit to undo, or one undone to redo. */
  canUndo: boolean;
  canRedo: boolean;
  commands: AppCommand[];
  /** The address of what's on screen, with the open page's row: Copy Link's. */
  address: string;
}

const sameAs = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * `f`'s last answer again when it's asked the same thing (each argument
 * the same object or value): a render that changes nothing about the
 * table on screen, like opening a panel, doesn't work its rows out again.
 */
function lastAnswer<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  let asked: A | undefined;
  let answer: R;
  return (...args) => {
    if (asked && sameAs(asked, args)) return answer;
    answer = f(...args);
    asked = args;
    return answer;
  };
}

const summaryLast = lastAnswer(
  (table: ParsedTable, shown: number, inView: number, searching: boolean, openedAt: number | undefined) =>
    viewSummary(table, { shown, inView, searching, openedAt }),
);

let lastShown: { asked: unknown[]; answer: ShownView } | undefined;

/** The rows on screen. They read the tables of the active bundle (lookups, Sheet grids), so those are what is compared. */
function shownLast(tables: Record<string, ParsedTable>, key: string, view: View, arrangement: Arrangement | undefined, search: string, locale: string | undefined): ShownView {
  const prefix = `${bundleOf(key)}/`;
  const asked: unknown[] = [key, view, arrangement, search, locale];
  for (const k in tables) if (k.startsWith(prefix)) asked.push(k, tables[k]);
  if (lastShown && sameAs(lastShown.asked, asked)) return lastShown.answer;
  const answer = showView(tables, key, view, { arrangement, search, viewerText: viewerOrder(locale) });
  lastShown = { asked, answer };
  return answer;
}

export function derive(state: AppState, options: DeriveOptions = {}): Derived {
  const table = state.tables[state.active] ?? NO_TABLE;
  const viewId = viewIdOf(state, state.active);
  const view = table.views.find((v) => v.id === viewId) ?? table.views[0] ?? NO_TABLE.views[0]!;
  const arrangement = state.arrangements[state.active]?.[view.id];
  const locale = viewerLocale(state.display, options.locale);
  const held = state.tables[state.active] !== undefined;
  // An indexed table's rows aren't here: the app reads them through the index (indexedViewRows).
  const shown: ShownView =
    held && !table.indexed
      ? shownLast(state.tables, state.active, view, arrangement, state.search, locale)
      : { view: arrangedView(view, arrangement), rows: [], inView: options.indexedShown?.inView ?? table.indexed?.count ?? 0 };
  const live = (a: string) => addressLive(a, state.tables, state.bundles);
  const canGoBack = goBack(state.history, live) !== null;
  const canGoForward = goForward(state.history, live) !== null;
  const mode = state.sidebar.files ? "files" : "tables";
  const canUndo = mode === "tables" && (state.undo[state.active]?.past.length ?? 0) > 0;
  const canRedo = mode === "tables" && (state.undo[state.active]?.future.length ?? 0) > 0;
  const tree = sidebarTree(state.tables, state.bundles, {
    folded: state.sidebar.foldedFiles,
    expanded: [state.active],
    ...(held ? { active: { key: state.active, viewId: view.id } } : {}),
    ...(options.newTableIn ? { newTableIn: options.newTableIn } : {}),
  });
  return {
    table,
    view,
    arrangement,
    arranged: isArranged(arrangement),
    shown,
    summary: summaryLast(
      table,
      table.indexed ? (options.indexedShown?.count ?? table.indexed.count) : shown.rows.length,
      shown.inView,
      state.search.trim().length > 0,
      state.openedAt[state.active],
    ),
    breadcrumb: tableBreadcrumb(state.active, state.tables, state.bundles, options.fileNameOf?.(bundleOf(state.active))),
    mode,
    locale,
    direction: textDirection(locale),
    sidebarTree: tree,
    sidebarEntries: flattenSidebar(tree),
    filesTree:
      mode === "files"
        ? filesTree(state.tables, state.bundles, {
            folded: state.sidebar.foldedFiles,
            activeTable: state.active,
            opened: state.openedDirs,
            ...(options.attachmentsOf ? { attachmentsOf: options.attachmentsOf } : {}),
          })
        : [],
    canGoBack,
    canGoForward,
    canUndo,
    canRedo,
    commands: appCommands({ sidebarCollapsed: state.sidebar.collapsed === true, filesMode: mode === "files", canGoBack, canGoForward, canUndo, canRedo }),
    address: viewAddress(state.active, view.id, state.openPage ?? undefined),
  };
}

/** ViewProps' callbacks that the reducer answers, for the view on screen. */
export type ViewCallbacks = Required<
  Pick<
    ViewProps,
    | "onUpdateRow"
    | "onUpdateField"
    | "onAddEnumValue"
    | "onRemoveEnumValue"
    | "onDeleteField"
    | "onMoveField"
    | "onRestoreSchema"
    | "onAddField"
    | "onAddRow"
    | "onDeleteRow"
    | "onOpenBody"
    | "onUpdateView"
    | "onOpenRelation"
    | "onInsertRow"
  >
>;

/**
 * The view on screen's callbacks, each dispatching its action. `newId`
 * gives a new row its id, so the reducer stays deterministic. Attaching a
 * file is the app's own (it picks a file and copies it), so it isn't here.
 */
export function viewCallbacks(state: AppState, dispatch: (action: AppAction) => void, newId: () => string): ViewCallbacks {
  return {
    onUpdateRow: (rowId, field, value) => dispatch({ type: "updateRow", rowId, field, value }),
    onUpdateField: (name, patch) => dispatch({ type: "updateField", name, patch }),
    onAddEnumValue: (name, value) => dispatch({ type: "addChoice", name, value }),
    onRemoveEnumValue: (name, value) => dispatch({ type: "removeChoice", name, value }),
    onDeleteField: (name) => dispatch({ type: "deleteField", name }),
    onMoveField: (name, delta) => dispatch({ type: "moveField", name, delta }),
    onRestoreSchema: (schema) => dispatch({ type: "restoreSchema", schema }),
    onAddField: (field) => dispatch({ type: "addField", field }),
    onAddRow: () => {
      const id = newId();
      dispatch({ type: "addRow", id });
      return id;
    },
    onDeleteRow: (rowId) => dispatch({ type: "deleteRow", rowId }),
    onOpenBody: (rowId) => dispatch({ type: "openPage", rowId }),
    onUpdateView: (patch) => dispatch({ type: "updateView", patch }),
    onOpenRelation: (address) => {
      const target = addressTarget(address, state.tables, state.bundles, bundleOf(state.active));
      if (target) dispatch({ type: "follow", target });
    },
    onInsertRow: (anchor, where) => dispatch({ type: "insertRow", anchor, where, id: newId() }),
  };
}
