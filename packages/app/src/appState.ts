// Everything an app around the .table views holds, and every change to it,
// as one reducer (docs/APP-STATE.md): which table and view are on screen,
// the tables themselves and the edits made to them, this viewer's own
// arrangements and settings, and the questions to ask before a change
// that can't be undone. Pure, as the rest of table-app is: no React, no
// renderer, no storage. Each app draws what `derive` gives it, shows
// `asking` and `telling` its own way, and writes the bundles in `dirty`.

import { coordinateOf, isSheet, mergeOfRange, mergeOver, renameField, textDirection, withMerge, type Address, type BundleMeta, type Field, type ParsedTable, type Row, type TableSchema, type UnreadLine, type ValidationError, type View } from "@workspace.sh/table-core";
import { canInsertAt, visibleFields, type DisplaySettingKind, type DisplaySettings, type ViewProps } from "@workspace.sh/table-ui/shared";

import { arrange, arrangedView, isArranged, reset as resetArrangement, savingForEveryone, type Arrangement, type Arrangements } from "./arrangements.ts";
import { tableBreadcrumb, type Breadcrumb } from "./breadcrumb.ts";
import { addressTarget, applyTarget, bundleOf, bundleTables, tableNameOf, type AddressTarget } from "./bundles.ts";
import { appCommands, type AppCommand } from "./commands.ts";
import { canClose, closePrompt, withClosed } from "./closing.ts";
import { CANCEL, type Confirm } from "./confirm.ts";
import { creating, namePrompt, newView, type Making, type NamePrompt } from "./creating.ts";
import { viewerLocale, viewerOrder, withDisplayChoice } from "./displaySettings.ts";
import {
  bumpSchemaVersion,
  deletingField,
  fieldRenameProblem,
  deletingRow,
  deletingView,
  removingChoice,
  withoutChoice,
  withoutField,
  onTable,
  viewPatchPrompt,
  withBody,
  withCell,
  withCellFormula,
  withCellNote,
  withIteration,
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
  type FieldPlace,
} from "./edits.ts";
import { afterCellEdit, departedCount, type Departed } from "./departed.ts";
import { indexChanges, logged, NO_EDIT_LOG, pruned, recorded, settledPages, written, type EditLogState } from "./editLog.ts";
import { filesTree, type FilesTreeBundle } from "./filesTree.ts";
import type { IndexEdit } from "./indexed.ts";
import { addressLive, goBack, goForward, NO_HISTORY, viewAddress, visited, type History, type Place } from "./history.ts";
import { leaving } from "./leaving.ts";
import type { Library } from "./library.ts";
import { afterReset, resetPrompt } from "./resetting.ts";
import { sheetShown, showView, type ShownView } from "./showView.ts";
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
  | { type: "create"; making: Making }
  | { type: "close"; bundle: string }
  | { type: "note"; key: string; rowId: string; field: string }
  | { type: "merge"; key: string; viewId: string };

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
  /**
   * The bundles that are single-file `.table`s, and where each file is
   * (Library.singleFiles): `opened` then names its working folder. Such a
   * file isn't offered as a single-file export: it is one already.
   */
  singleFiles?: Record<string, string>;
  /** Each table's schema-version when it was opened, for "schema changed" (D22). */
  openedAt: Record<string, number>;
  /** Tables held in memory because their index couldn't be made: why, by key (said in their summary). */
  held?: Record<string, string>;
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
  /**
   * Bundles edited since they were last written. One no longer held was
   * closed: the app's write removes what it kept of it.
   */
  dirty: string[];
  /** Bundles closed here, for the app to keep: an example closed stays out of the next launch's. */
  closed: string[];
  /**
   * Edits to rows of tables held in the index (`ParsedTable.indexed`),
   * in order, for the app to make there: their rows aren't in `tables`
   * to change. Each goes once the app says it's made (`indexed`).
   */
  indexWork: IndexWork[];
  /**
   * What undo puts back, for each table: a step for each edit to its rows,
   * its fields or its views, newest last, and what redo puts back after an
   * undo. Where you are (the cell selected, the view, the page open) isn't
   * an edit, and isn't here.
   */
  undo: Record<string, { past: UndoStep[]; future: UndoStep[] }>;
  /**
   * What was edited and not yet written to its table's history
   * (`history.ndjson`, SPEC section 14), for the app to append and then
   * say so (`editsWritten`). Kept only when the app writes history
   * (`AppStart.writesHistory`).
   */
  editLog: EditLogState;
  /**
   * Rows a discrete edit took out of the view on screen, for the toast that
   * says so and puts them back (departed.ts, #598); null when there's none.
   */
  departed: Departed | null;
}

/**
 * One edit, to take back. `table` is the table as it was before it. `rows`
 * is an edit to a row of a table held in the index, whose rows aren't
 * here: the edit itself (`forth`, which redo makes again) and the one that
 * undoes it (`back`), which for a cell or a row removed only the index
 * knows, so it's null until the app has made the edit (`n`) and said;
 * `page` is the page of a row removed, to go back with it. `name` says
 * what the edit was, for a menu ("Delete Row": Undo Delete Row). `run` is given
 * to edits that are one stretch of the same thing (typing in a page),
 * which undo as one.
 */
export type UndoStep = { name: string; run?: string } & (
  /** `others`: other tables the edit changed with it (a field renamed, and the formulas that read it), undone with it. */
  | { table: ParsedTable; others?: Record<string, ParsedTable> }
  | { rows: { n: number; back: IndexEdit | null; forth: IndexEdit; page?: string } }
);

/** The most steps kept for a table, the fewest, and the rows those steps may list between them. */
const UNDO_STEPS = 100;
const UNDO_FEWEST = 20;
const UNDO_ROWS = 2_000_000;

/** One edit to a row of an indexed table; `n` counts them. */
export type IndexWork = { n: number; key: string } & IndexEdit;

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
  /** A cell given its own formula (D52), in the stored form; null takes it away. */
  | { type: "setCellFormula"; rowId: string; field: string; expr: string | null }
  /** A cell's note (D57); empty takes it away. */
  | { type: "setCellNote"; rowId: string; field: string; note: string }
  /** The table's loops worked out by repeating (D60); null, a loop is #REF!. */
  | { type: "setIteration"; iteration: { max: number; change: number } | null }
  /** Ask which block of a Sheet view's cells to merge, starting from a cell (D58). */
  | { type: "askMerge"; rowId: string; field: string }
  /** Show the merged block over a cell as its cells again (D58). */
  | { type: "unmerge"; rowId: string; field: string }
  /** Ask for a cell's note, starting from the one it has (D57). */
  | { type: "askCellNote"; rowId: string; field: string; note?: string }
  | { type: "addRow"; id: string }
  | { type: "insertRow"; anchor: string; where: "above" | "below"; id: string }
  | { type: "deleteRow"; rowId: string }
  // `table`: the table it's in, when that may no longer be the one on
  // screen (a page saved as it's typed, its last save landing after a move).
  | { type: "updateBody"; rowId: string; content: string; table?: string }
  | { type: "updateField"; name: string; patch: Partial<Field> }
  | { type: "addField"; field: Field; place?: FieldPlace }  /**
   * The field's name (its key) becomes `to`, everywhere it's used: its
   * rows, views and cells, and every formula that reads it, in its table
   * or another of its file (renameField). Its id and title stay.
   */
  | { type: "renameField"; name: string; to: string }

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
  /**
   * Files read again in place of what's held of them: their tables are
   * the ones read, and edits not yet written are let go. After a save
   * found the file changed elsewhere (ChangedElsewhere), for the file as
   * it now is.
   */
  | { type: "replaced"; library: Library }
  /**
   * Close a file: asks first, then it leaves what's held and is marked to
   * write (closing.ts). `fromFolder` is for an app that knows better than
   * `opened` where the file lives (one whose every file is a folder on
   * disk): true when closing leaves the folder where it is.
   */
  | { type: "close"; bundle: string; fromFolder?: boolean }
  | { type: "reset"; fresh: Library }
  | { type: "answer"; response: string; text?: string }
  | { type: "tell"; message: Telling }
  | { type: "told" }
  | { type: "written"; bundles: string[]; tables?: Record<string, ParsedTable> }
  /**
   * An indexed table's rows as they now are: how many, after a build or
   * after the edits up to `done` (an IndexWork's `n`) were made, which
   * then leave the queue and the table is to be written. `back` is what
   * undoes each of them, by its `n` (table-app's remoteEdits gives it).
   */
  /** Put the table on screen back as it was before its last edit; and forward again. */
  | { type: "undo" }
  | { type: "redo" }
  /** The toast saying rows left the view is gone (its time is up, or it was dismissed). */
  | { type: "departedDone" }
  /** Put back every row the toast counted, as they were before, as one step (#598). */
  | { type: "putBackDeparted" }
  | { type: "indexed"; key: string; count: number; done?: number; back?: Record<number, IndexEdit> }
  /**
   * A table read again, to hold in place of the one held: an indexed table
   * whose index couldn't be made, now in memory. `held` says why, on the
   * table (its summary), not as an alert.
   */
  | { type: "reloaded"; key: string; table: ParsedTable; held?: string }
  /**
   * A table opened without its rows (`loading`, a reader's rows: "later")
   * has them now, with what the reader said of them: it can be edited.
   */
  | { type: "rowsRead"; key: string; rows: Row[]; rowFiles: { name: string; ids: string[] }[]; unread: UnreadLine[]; diagnostics: ValidationError[] }
  /** The app has appended the first `count` of a table's kept edits to its history. */
  | { type: "editsWritten"; key: string; count: number }
  /** Every page's stretch of changes is over (typing has been still a while, or the app is about to close): each is said, the open one too. */
  | { type: "pagesSettled" };

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
  /** Of those, the single files, and where each file is. */
  singleFiles?: Record<string, string>;
  stored?: StoredPrefs;
  /** Where to open: an address, as a link or the page's own address gives it. */
  start?: Address | string;
  /** The app appends edits to each table's history (`state.editLog`), so they are kept for it. */
  writesHistory?: boolean;
  /** Bundles closed before, as the app kept them. */
  closed?: string[];
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
    ...(input.singleFiles ? { singleFiles: input.singleFiles } : {}),
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
    closed: input.closed ?? [],
    indexWork: [],
    undo: {},
    editLog: input.writesHistory ? { ...NO_EDIT_LOG, on: true } : NO_EDIT_LOG,
    departed: null,
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
  next = withDeparted(prev, next, action);
  // What the action edited, kept for the table's history.
  if (next.editLog.on) {
    const open = next.openPage !== null ? { key: next.active, rowId: next.openPage } : null;
    // (Deleting a row asks first: its answer is the edit.)
    const edits = ROW_EDITS.has(action.type) || (action.type === "answer" && (prev.asking?.on.type === "deleteRow" || prev.asking?.on.type === "note"));
    let editLog = next.tables === prev.tables ? next.editLog : pruned(next.editLog, next.tables);
    // The examples put back as they shipped: their files are new, and what was edited before is no part of them.
    if (action.type === "answer" && prev.asking?.on.type === "reset" && next.tables !== prev.tables) editLog = { ...NO_EDIT_LOG, on: true };
    if (edits) editLog = recorded(editLog, prev.tables, next.tables, open);
    // A page left: its stretch of changes is over.
    else if (next.openPage !== prev.openPage || next.active !== prev.active) editLog = settledPages(editLog, next.tables, open);
    if (editLog !== next.editLog) next = { ...next, editLog };
  }
  return next;
}

/**
 * The actions that edit rows or pages, whose changes go to the table's
 * history. Any other action that replaces a table isn't an edit to say:
 * a file opened or read again, rows moved into the index, the examples
 * reset, a field's change and what it does to the rows.
 */
const ROW_EDITS: ReadonlySet<AppAction["type"]> = new Set(["updateRow", "setCellFormula", "setCellNote", "addRow", "insertRow", "updateBody", "undo", "redo", "putBackDeparted"]);

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
 * A table held in the index has its rows there, not here: an edit to its
 * views or its fields is kept here (the index is changed back in place on
 * undo), and one to its rows as it's queued for the index (`queued`).
 */
function edit(state: AppState, name: string, change: (table: ParsedTable) => ParsedTable, key = state.active, run?: string): AppState {
  // Its rows not read yet: nothing of it is changed until they are (isEditable).
  if (state.tables[key]?.loading) return state;
  const tables = onTable(state.tables, key, change);
  if (tables === state.tables) return state;
  const next = { ...state, tables, dirty: marked(state.dirty, bundleOf(key)) };
  const before = state.tables[key]!;
  if (before.indexed) {
    const after = tables[key]!;
    // A change of fields is made in the index where it is, so undo can make it the other way (#562).
    // What an undo had brought back is the index's now: a field added later is new.
    if (after.schema !== before.schema && after.indexed?.restore) {
      const { restore: _, ...indexed } = after.indexed;
      next.tables = { ...tables, [key]: { ...after, indexed } };
    }
    if (after.schema === before.schema && after.views === before.views) return next;
  }
  const stack = state.undo[key] ?? { past: [], future: [] };
  const last = stack.past.at(-1);
  // Another edit of the same stretch: the step already kept is where undo goes back to.
  const past =
    run !== undefined && last?.run === run
      ? stack.past
      : [...stack.past, { name, table: before, ...(run !== undefined ? { run } : {}) }].slice(-stepsKept(before));
  return { ...next, undo: { ...state.undo, [key]: { past, future: [] } } };
}

/**
 * What an edit to a cell is called: "Edit Title", by the field's title. A
 * field with no title of its own is called by its key, written as a menu
 * writes a name: `close_date` is "Close Date".
 */
function cellEditName(state: AppState, field: string, key = state.active): string {
  const title = state.tables[key]?.schema.fields.find((f) => f.name === field)?.title;
  return `Edit ${title ?? field.replace(/[_-]+/g, " ").replace(/(^|\s)\p{Ll}/gu, (letter) => letter.toUpperCase())}`;
}

/**
 * The toast's rows after an action (departed.ts): counted on by a discrete
 * edit that takes a row out of the view on screen; over when another view
 * or table shows, or another kind of edit is made.
 */
function withDeparted(prev: AppState, next: AppState, action: AppAction): AppState {
  if (!next.departed && action.type !== "updateRow") return next;
  let departed = next.departed;
  if (action.type === "updateRow" && next.tables !== prev.tables) {
    const before = prev.tables[prev.active];
    const after = next.tables[prev.active];
    if (before && after) departed = afterCellEdit(departed, before, after, prev.active, currentView(prev), action.rowId, action.field);
  } else if (ROW_EDITS.has(action.type) && next.tables !== prev.tables) {
    departed = null;
  }
  if (departed && (next.active !== departed.key || viewIdOf(next, next.active) !== departed.viewId)) departed = null;
  return departed === next.departed ? next : { ...next, departed };
}

/** This viewer's own arrangements of a table's views, a field of it renamed. */
function arrangementsRenamed(arrangements: Arrangements, key: string, from: string, to: string): Arrangements {
  const mine = arrangements[key];
  if (!mine || !JSON.stringify(mine).includes(JSON.stringify(from))) return arrangements;
  const field = <T extends { field: string }>(x: T): T => (x.field === from ? { ...x, field: to } : x);
  const views = Object.fromEntries(
    Object.entries(mine).map(([id, a]) => [
      id,
      {
        ...a,
        ...(a.filter ? { filter: a.filter.map(field) } : {}),
        ...(a.sort ? { sort: a.sort.map(field) } : {}),
        ...(a.group ? { group: field(a.group) } : {}),
      },
    ]),
  );
  return { ...arrangements, [key]: views };
}

/** A change that is only a new title: a rename. */
const onlyTitle = (patch: object): boolean => Object.keys(patch).length === 1 && "title" in patch;

/** How many steps a table keeps: fewer for a long one, each of whose row edits keeps a list of every row. */
function stepsKept(table: ParsedTable): number {
  return Math.max(UNDO_FEWEST, Math.min(UNDO_STEPS, Math.floor(UNDO_ROWS / Math.max(1, table.rows.length))));
}

function without<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (!keys.some((k) => k in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k)));
}

/** Undo or redo on the table on screen: its last step taken back (or made again), and put on the other stack. */
function stepBack(state: AppState, from: "past" | "future"): AppState {
  const key = state.active;
  const now = state.tables[key];
  const stack = state.undo[key];
  const step = stack?.[from].at(-1);
  if (!now || !stack || !step || state.sidebar.files) return state;
  const to = from === "past" ? "future" : "past";
  const run = step.run !== undefined ? { run: step.run } : {};
  const moved = (other: UndoStep) => ({ ...state.undo, [key]: { ...stack, [from]: stack[from].slice(0, -1), [to]: [...stack[to], other] } });
  if ("rows" in step) {
    // A row in the index: the edit that undoes it, or the edit again, is queued as the edit was.
    const made = from === "past" ? step.rows.back : step.rows.forth;
    // Not yet known: the app is still making the edit this would undo.
    if (!made) return state;
    const tables = onTable(state.tables, key, (t) => withIndexEdit(t, made));
    const held = tables === state.tables ? state : { ...state, tables, dirty: marked(state.dirty, bundleOf(key)) };
    return { ...queued(held, key, made), undo: moved(step) };
  }
  // A table held in the index: its views and fields go back, its rows stay what the index holds.
  // Fields that come back come back with their values, which the index kept hidden (#562).
  const restore = step.table.schema.fields.filter((f) => !now.schema.fields.some((g) => g.name === f.name)).map((f) => f.name);
  const table = now.indexed
    ? { ...now, views: step.table.views, schema: step.table.schema, indexed: { count: now.indexed.count, version: now.indexed.version, ...(restore.length > 0 ? { restore } : {}) } }
    : step.table;
  // Other tables the edit changed with this one go back (or forward) with it, and are kept as they are now for the way back.
  const others = step.others ? Object.fromEntries(Object.keys(step.others).flatMap((k) => (state.tables[k] ? [[k, state.tables[k]!]] : []))) : undefined;
  const dirty = Object.keys(step.others ?? {}).reduce((d, k) => marked(d, bundleOf(k)), marked(state.dirty, bundleOf(key)));
  return {
    ...state,
    tables: { ...state.tables, ...step.others, [key]: table },
    dirty,
    undo: moved({ name: step.name, table: now, ...run, ...(others ? { others } : {}) }),
  };
}

/** A stretch of edits is over (the page being typed in was closed): the next edit like it is its own step. */
function runEnded(state: AppState, key: string): AppState {
  const stack = state.undo[key];
  const last = stack?.past.at(-1);
  if (!stack || last?.run === undefined) return state;
  const { run: _, ...ended } = last;
  return { ...state, undo: { ...state.undo, [key]: { ...stack, past: [...stack.past.slice(0, -1), ended] } } };
}

/**
 * An edit to an indexed table's row, for the app to make in the index.
 * `step` keeps it for undo, with the edit that undoes it where that's
 * known here (`back`; null where only the index knows, which the app says
 * once it's made). Without `step` nothing is kept: the edit is an undo or
 * a redo itself.
 */
function queued(state: AppState, key: string, edit: IndexEdit, step?: { name: string; back: IndexEdit | null; run?: string; page?: string }): AppState {
  const n = (state.indexWork.at(-1)?.n ?? 0) + 1;
  const next = { ...state, indexWork: [...state.indexWork, { ...edit, n, key }] };
  if (!step) return next;
  const { name, back, run, page } = step;
  const stack = state.undo[key] ?? { past: [], future: [] };
  const last = stack.past.at(-1);
  // Another edit of the same stretch: undo still goes back to before the first, and redo makes the last.
  const past =
    run !== undefined && last?.run === run && "rows" in last
      ? [...stack.past.slice(0, -1), { ...last, rows: { ...last.rows, forth: edit } }]
      : [...stack.past, { name, rows: { n, back, forth: edit, ...(page !== undefined ? { page } : {}) }, ...(run !== undefined ? { run } : {}) }].slice(-UNDO_STEPS);
  return { ...next, undo: { ...state.undo, [key]: { past, future: [] } } };
}

/** What an edit to an indexed table's row changes of what's held here: its page. */
function withIndexEdit(table: ParsedTable, edit: IndexEdit): ParsedTable {
  if (edit.kind === "body") return withIndexedBody(table, edit.rowId, edit.content);
  if (edit.kind === "remove") return withoutRow(table, edit.rowId);
  if (edit.kind === "restore" && edit.content !== undefined) return withIndexedBody(table, edit.rowId, edit.content);
  return table;
}

/**
 * The app has made the edits up to `done`: each step waiting to hear what
 * undoes its edit has it now, a row removed going back with its page. A
 * step whose edit changed nothing, or failed, has nothing to undo, and goes.
 */
function stepsHeard(stack: { past: UndoStep[]; future: UndoStep[] } | undefined, done: number, back: Record<number, IndexEdit> | undefined) {
  if (!stack?.past.some((s) => "rows" in s && s.rows.back === null && s.rows.n <= done)) return stack;
  const past = stack.past.flatMap((step): UndoStep[] => {
    if (!("rows" in step) || step.rows.back !== null || step.rows.n > done) return [step];
    const edit = back?.[step.rows.n];
    if (!edit) return [];
    const { page } = step.rows;
    return [{ ...step, rows: { ...step.rows, back: edit.kind === "restore" && page !== undefined ? { ...edit, content: page } : edit } }];
  });
  return { ...stack, past };
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

/** A Sheet view's grid as saved (D41): its columns and its rows, in order. Undefined for any other view. */
function sheetGridOf(state: AppState, key: string, view: View): { columns: string[]; rows: string[] } | undefined {
  const table = state.tables[key];
  const order = table && sheetShown(state.tables, key, view)?.order;
  return order ? { columns: visibleFields(view, table.schema), rows: order } : undefined;
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
      const reverted = edit(state, "Change View", (t) => (t.views === before.views ? t : { ...t, views: before.views }), before.key);
      const { [before.key]: _, ...others } = state.arrangements;
      return {
        ...reverted,
        arrangements: before.arrangements ? { ...others, [before.key]: before.arrangements } : others,
        viewIds: { ...reverted.viewIds, [before.key]: before.viewId },
        settingsOpen: false,
      };
    }

    case "updateRow":
      if (state.tables[state.active]?.indexed) {
        return queued(state, state.active, { kind: "cell", rowId: action.rowId, field: action.field, value: action.value }, { name: cellEditName(state, action.field), back: null });
      }
      return edit(state, cellEditName(state, action.field), (t) => withCell(t, action.rowId, action.field, action.value));
    case "setCellFormula":
      if (state.tables[state.active]?.indexed) {
        // Made in the index, which knows what it had: undo is the edit it gives back.
        return queued(state, state.active, { kind: "formula", rowId: action.rowId, field: action.field, expr: action.expr }, { name: cellEditName(state, action.field), back: null });
      }
      return edit(state, cellEditName(state, action.field), (t) => withCellFormula(t, action.rowId, action.field, action.expr));
    case "setIteration":
      // An index works a row out at a time: a table that iterates is held in memory (canBeIndexed), so one in an index can't.
      if (state.tables[state.active]?.indexed) return state;
      return edit(state, action.iteration ? "Repeat Loops" : "Stop Repeating Loops", (t) => withIteration(t, action.iteration));
    case "askMerge": {
      const view = currentView(state);
      const grid = view && sheetGridOf(state, state.active, view);
      if (!view || !grid) return state;
      const at = coordinateOf(action.field, action.rowId, grid);
      return {
        ...state,
        asking: {
          kind: "name",
          prompt: { heading: "Merge Cells", action: "Merge", placeholder: "B2:C4", ...(at ? { value: `${at}:` } : {}) },
          on: { type: "merge", key: state.active, viewId: view.id },
        },
      };
    }
    case "unmerge": {
      const view = currentView(state);
      const grid = view && sheetGridOf(state, state.active, view);
      if (!view || !grid) return state;
      const at = mergeOver(view, action.field, action.rowId, grid.columns, grid.rows);
      if (at === -1) return state;
      const merged = view.merged!.filter((_, i) => i !== at);
      return edit(state, "Unmerge Cells", (t) => withViewPatch(t, view.id, { merged: merged.length > 0 ? merged : undefined }));
    }
    case "askCellNote": {
      const table = state.tables[state.active];
      if (!table) return state;
      // Called as its column is (Edit Budget, Note on Budget).
      const title = cellEditName(state, action.field).slice("Edit ".length);
      // Held in memory, the note it has is here; in an index, the view says what it read.
      const note = table.indexed ? action.note : table.cells?.find((c) => c.id === action.rowId && c.field === action.field)?.note;
      return {
        ...state,
        asking: {
          kind: "name",
          prompt: { heading: `Note on ${title}`, action: "Save", placeholder: "A note on this cell", ...(note ? { value: note } : {}) },
          on: { type: "note", key: state.active, rowId: action.rowId, field: action.field },
        },
      };
    }
    case "setCellNote":
      if (state.tables[state.active]?.indexed) {
        return queued(state, state.active, { kind: "note", rowId: action.rowId, field: action.field, note: action.note }, { name: "Edit Note", back: null });
      }
      return edit(state, "Edit Note", (t) => withCellNote(t, action.rowId, action.field, action.note));
    case "addRow":
      if (state.tables[state.active]?.indexed) {
        return queued(state, state.active, { kind: "add", rowId: action.id }, { name: "Add Row", back: { kind: "remove", rowId: action.id } });
      }
      return edit(state, "Add Row", (t) => withRow(t, action.id));
    case "insertRow": {
      // Only in a Sheet view whose order isn't decided by a sort (D41).
      const view = currentView(state);
      if (!view || !isSheet(view) || !canInsertAt(view)) return state;
      return edit(state, "Add Row", (t) => withRowAt(t, view.id, action.anchor, action.where, action.id));
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
        const was = state.tables[key]!.bodies?.[action.rowId] ?? "";
        const held = edit(state, "Edit Page", (t) => withIndexedBody(t, action.rowId, action.content), key);
        if (held === state) return state;
        // Each save of a page while it's typed in is one stretch: undo takes it back whole.
        return queued(held, key, { kind: "body", rowId: action.rowId, content: action.content }, { name: "Edit Page", back: { kind: "body", rowId: action.rowId, content: was }, run: `page:${action.rowId}` });
      }
      return edit(state, "Edit Page", (t) => withBody(t, action.rowId, action.content), action.table, `page:${action.rowId}`);
    }
    case "updateField":
      return edit(state, onlyTitle(action.patch) ? "Rename Field" : "Change Field", (t) => withFieldPatch(t, action.name, action.patch));
    case "renameField": {
      const key = state.active;
      const table = state.tables[key];
      if (!table || fieldRenameProblem(table, action.name, action.to) !== null) return state;
      const bundle = bundleOf(key);
      const held = bundleTables(state.tables, bundle);
      const renamed = renameField(held, tableNameOf(key), action.name, action.to);
      const changed = Object.keys(renamed).filter((n) => renamed[n] !== held[n]).map((n) => `${bundle}/${n}`);
      const bumped = (k: string) => {
        const t = renamed[tableNameOf(k)]!;
        return t.schema === state.tables[k]!.schema ? t : { ...t, schema: bumpSchemaVersion(t.schema) };
      };
      const made = edit(state, "Rename Field", () => bumped(key), key);
      if (made === state) return state;
      const others = changed.filter((k) => k !== key);
      const stack = made.undo[key]!;
      const step = stack.past.at(-1)!;
      return {
        ...made,
        tables: { ...made.tables, ...Object.fromEntries(others.map((k) => [k, bumped(k)])) },
        undo: { ...made.undo, [key]: { ...stack, past: [...stack.past.slice(0, -1), { ...step, others: Object.fromEntries(others.map((k) => [k, state.tables[k]!])) }] } },
        arrangements: arrangementsRenamed(made.arrangements, key, action.name, action.to),
        ...(made.place.field === action.name ? { place: { ...made.place, field: action.to } } : {}),
      };
    }
    case "addField":
      return edit(state, "Add Field", (t) => withField(t, action.field, viewIdOf(state, state.active), action.place));
    case "moveField":
      return edit(state, "Move Field", (t) => withFieldMoved(t, action.name, action.delta));
    case "restoreSchema":
      return edit(state, "Change Fields", (t) => (t.schema === action.schema ? t : { ...t, schema: action.schema }));
    case "addChoice":
      return edit(state, "Add Choice", (t) => withChoice(t, action.name, action.value));
    case "removeChoice": {
      // Rows that hold it lose it, so ask first; none hold it, it just goes.
      const table = state.tables[state.active];
      if (!table) return state;
      const prompt = removingChoice(table, action.name, action.value);
      if (!prompt) return edit(state, "Remove Choice", (t) => withoutChoice(t, action.name, action.value));
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
      return edit(state, onlyTitle(action.patch) ? "Rename View" : "Change View", (t) => withViewPatch(t, view.id, action.patch));
    }
    case "addView": {
      // A plain table of everything; its settings open, where it's made into what's wanted.
      const edited = edit(state, "Add View", (t) => withView(t, newView(action.id)));
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
      return { ...edit(state, "Save View for Everyone", (t) => withViewPatch(t, view.id, saving.patch)), arrangements: saving.arrangements };
    }
    case "resetArrangement": {
      const view = currentView(state);
      const arrangements = view ? resetArrangement(state.arrangements, state.active, view.id) : state.arrangements;
      return arrangements === state.arrangements ? state : { ...state, arrangements };
    }
    case "display":
      return { ...state, display: withDisplayChoice(state.display, action.choice.kind, action.choice.value, state.active || undefined) };
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
          ...(library.singleFiles || state.singleFiles ? { singleFiles: { ...without(state.singleFiles ?? {}, keys), ...library.singleFiles } } : {}),
          openedAt: { ...state.openedAt, ...schemaVersions(library.tables) },
          viewIds: { ...firstViews(library.tables), ...state.viewIds },
          dirty: unkept.reduce(marked, state.dirty),
          closed: state.closed.filter((b) => !(b in library.bundles)),
          ...(told ? { telling: told } : {}),
        },
        firstTableKey(library.tables),
      );
    }
    case "replaced": {
      const keys = Object.keys(action.library.bundles);
      const held = (key: string) => keys.includes(bundleOf(key));
      const cleared = { ...state, tables: Object.fromEntries(Object.entries(state.tables).filter(([key]) => !held(key))), dirty: state.dirty.filter((b) => !keys.includes(b)) };
      return tableApp(cleared, { type: "opened", library: action.library });
    }
    case "close": {
      const meta = state.bundles[action.bundle];
      if (!meta || !canClose(state.bundles, action.bundle)) return state;
      const prompt = closePrompt(meta.title ?? action.bundle, action.fromFolder ?? state.opened[action.bundle] !== undefined);
      return { ...state, asking: { kind: "confirm", confirm: prompt, on: { type: "close", bundle: action.bundle } } };
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
        ...(action.held !== undefined || state.held?.[action.key] !== undefined
          ? { held: { ...without(state.held ?? {}, [action.key]), ...(action.held !== undefined ? { [action.key]: action.held } : {}) } }
          : {}),
        indexWork: state.indexWork.filter((w) => w.key !== action.key),
        undo: without(state.undo, [action.key]),
      };
    case "rowsRead": {
      const table = state.tables[action.key];
      if (!table?.loading) return state;
      const { loading: _, ...rest } = table;
      const read: ParsedTable = { ...rest, rows: action.rows };
      if (action.rowFiles.length > 0) read.rowFiles = action.rowFiles;
      if (action.unread.length > 0) read.unread = action.unread;
      if (action.diagnostics.length > 0) read.diagnostics = [...(table.diagnostics ?? []), ...action.diagnostics];
      // What it couldn't read is said, as opening says it when the rows come with the rest.
      const bundle = bundleOf(action.key);
      const told = state.telling ? null : skippedText(state.bundles[bundle]?.title ?? bundle, action.diagnostics.map((d) => `${tableNameOf(action.key)}: ${d.message}`));
      return { ...state, tables: { ...state.tables, [action.key]: read }, ...(told ? { telling: told } : {}) };
    }
    case "editsWritten": {
      const editLog = written(state.editLog, action.key, action.count);
      return editLog === state.editLog ? state : { ...state, editLog };
    }
    case "pagesSettled": {
      const editLog = settledPages(state.editLog, state.tables, null);
      return editLog === state.editLog ? state : { ...state, editLog };
    }
    case "departedDone":
      return state.departed ? { ...state, departed: null } : state;
    case "putBackDeparted": {
      const gone = state.departed;
      if (!gone) return state;
      const count = departedCount(gone);
      const putBack = edit(
        { ...state, departed: null },
        count === 1 ? "Put Back Row" : `Put Back ${count} Rows`,
        (t) => gone.rows.reduce((table, r) => withCell(table, r.rowId, r.field, r.was), t),
        gone.key,
      );
      return putBack.tables === state.tables ? { ...state, departed: null } : putBack;
    }
    case "undo":
      return stepBack(state, "past");
    case "redo":
      return stepBack(state, "future");
    case "indexed": {
      const table = state.tables[action.key];
      if (!table) return state;
      // What an undo brought back stays said until the app has changed the index for it (a later edit to the fields clears it).
      const indexed = { count: action.count, version: (table.indexed?.version ?? 0) + 1, ...(table.indexed?.restore ? { restore: table.indexed.restore } : {}) };
      const tables = { ...state.tables, [action.key]: { ...table, indexed } };
      // Its rows have just gone to the index: the steps kept list them as they were here.
      if (action.done === undefined) return { ...state, tables, undo: table.indexed ? state.undo : without(state.undo, [action.key]) };
      const done = action.done;
      const heard = stepsHeard(state.undo[action.key], done, action.back);
      // The edits now made, for the table's history: said here, where what each replaced is heard.
      const editLog = logged(
        state.editLog,
        action.key,
        indexChanges(
          state.indexWork.filter((w) => w.key === action.key && w.n <= done),
          action.back,
        ),
      );
      return {
        ...state,
        tables,
        indexWork: state.indexWork.filter((w) => w.key !== action.key || w.n > done),
        dirty: marked(state.dirty, bundleOf(action.key)),
        ...(editLog !== state.editLog ? { editLog } : {}),
        ...(heard && heard !== state.undo[action.key] ? { undo: { ...state.undo, [action.key]: heard } } : {}),
      };
    }
  }
}

function answered(state: AppState, asking: Asking, action: { response: string; text?: string }): AppState {
  const on = asking.on;
  if (action.response === CANCEL.id) return state;
  if (asking.kind === "confirm" && !asking.confirm.responses.some((r) => r.id === action.response)) return state;
  switch (on.type) {
    case "merge": {
      const view = state.tables[on.key]?.views.find((v) => v.id === on.viewId);
      const grid = view && sheetGridOf(state, on.key, view);
      if (!view || !grid) return state;
      const merge = mergeOfRange(action.text ?? "", grid.columns, grid.rows);
      if (!merge) return { ...state, telling: { heading: `“${(action.text ?? "").trim()}” isn't a block of cells`, body: "Type two of its corners, as B2:C4." } };
      return edit(state, "Merge Cells", (t) => withViewPatch(t, view.id, { merged: withMerge(view, merge, grid.columns, grid.rows) }), on.key);
    }
    case "note": {
      // Saved in the table it was asked of, wherever the screen is now.
      if (state.tables[on.key]?.indexed) {
        return queued(state, on.key, { kind: "note", rowId: on.rowId, field: on.field, note: action.text ?? "" }, { name: "Edit Note", back: null });
      }
      return edit(state, "Edit Note", (t) => withCellNote(t, on.rowId, on.field, action.text ?? ""), on.key);
    }
    case "deleteRow":
      // Its page, if open, goes with it (settle's rule).
      if (state.tables[on.key]?.indexed) {
        // What undoes it is the index's to say (the row, and where it was); its page is here, and kept to go back with it.
        const page = state.tables[on.key]!.bodies?.[on.rowId];
        return queued(edit(state, "Delete Row", (t) => withoutRow(t, on.rowId), on.key), on.key, { kind: "remove", rowId: on.rowId }, { name: "Delete Row", back: null, ...(page !== undefined ? { page } : {}) });
      }
      return edit(state, "Delete Row", (t) => withoutRow(t, on.rowId), on.key);
    case "deleteField":
      return edit(state, "Delete Field", (t) => withoutField(t, on.name), on.key);
    case "removeChoice":
      return edit(state, "Remove Choice", (t) => withoutChoice(t, on.name, on.value), on.key);
    case "deleteView": {
      const edited = edit(state, "Delete View", (t) => withoutView(t, on.viewId), on.key);
      if (edited === state) return state;
      // The next view shows, where this one was showing.
      return viewIdOf(state, on.key) === on.viewId
        ? { ...edited, viewIds: { ...edited.viewIds, [on.key]: on.nextViewId } }
        : edited;
    }
    case "updateView":
      return edit(state, onlyTitle(on.patch) ? "Rename View" : "Change View", (t) => withViewPatch(t, on.viewId, on.patch), on.key);
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
          closed: [],
        },
        firstTableKey(on.fresh.tables),
      );
    }
    case "close": {
      const { bundle } = on;
      if (!canClose(state.bundles, bundle)) return state;
      const gone = Object.keys(state.tables).filter((k) => bundleOf(k) === bundle);
      const inIt = (id: string) => id.startsWith(`${bundle}/`);
      const bundles = without(state.bundles, [bundle]);
      const tables = without(state.tables, gone);
      const next: AppState = {
        ...state,
        tables,
        bundles,
        opened: without(state.opened, [bundle]),
        ...(state.singleFiles ? { singleFiles: without(state.singleFiles, [bundle]) } : {}),
        openedAt: without(state.openedAt, gone),
        viewIds: without(state.viewIds, gone),
        undo: without(state.undo, gone),
        indexWork: state.indexWork.filter((w) => bundleOf(w.key) !== bundle),
        openedDirs: Object.fromEntries(Object.entries(state.openedDirs).filter(([id]) => !inIt(id))),
        shownFile: state.shownFile?.bundle === bundle ? null : state.shownFile,
        // Written away: the app removes what it kept of it.
        dirty: marked(state.dirty, bundle),
        closed: withClosed(state.closed, bundle),
      };
      return bundleOf(state.active) === bundle ? show({ ...next, openPage: null }, firstTableKey(tables)) : next;
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
  /** Whether a table has an edit history where the app keeps it, for the Files side to list it. */
  hasHistory?: (tableKey: string) => boolean;
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
  /** What undo would take back, and redo make again, as a menu says it ("Delete Row"); null when there's nothing. */
  undoName: string | null;
  redoName: string | null;
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
  (table: ParsedTable, shown: number, inView: number, searching: boolean, openedAt: number | undefined, held: string | undefined) =>
    viewSummary(table, { shown, inView, searching, openedAt, ...(held !== undefined ? { held } : {}) }),
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

/**
 * An indexed table's rows here: none, and always the same none. A new
 * empty list each time was a new prop for the table on every draw of the
 * app, which drew every row of the table again (a selection, a second).
 */
const INDEXED_ROWS: Row[] = [];

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
      : { view: arrangedView(view, arrangement), rows: INDEXED_ROWS, inView: options.indexedShown?.inView ?? table.indexed?.count ?? 0 };
  const live = (a: string) => addressLive(a, state.tables, state.bundles);
  const canGoBack = goBack(state.history, live) !== null;
  const canGoForward = goForward(state.history, live) !== null;
  const mode = state.sidebar.files ? "files" : "tables";
  const undoName = mode === "tables" ? (state.undo[state.active]?.past.at(-1)?.name ?? null) : null;
  const redoName = mode === "tables" ? (state.undo[state.active]?.future.at(-1)?.name ?? null) : null;
  const canUndo = undoName !== null;
  const canRedo = redoName !== null;
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
      state.held?.[state.active],
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
            ...(options.hasHistory ? { hasHistory: options.hasHistory } : {}),
          })
        : [],
    canGoBack,
    canGoForward,
    canUndo,
    canRedo,
    undoName,
    redoName,
    commands: appCommands({
      sidebarCollapsed: state.sidebar.collapsed === true,
      filesMode: mode === "files",
      canGoBack,
      canGoForward,
      canUndo,
      canRedo,
      undoName,
      redoName,
      singleFile: state.singleFiles?.[bundleOf(state.active)] !== undefined,
    }),
    address: viewAddress(state.active, view.id, state.openPage ?? undefined),
  };
}

/** ViewProps' callbacks that the reducer answers, for the view on screen. */
export type ViewCallbacks = Required<
  Pick<
    ViewProps,
    | "onUpdateRow"
    | "onSetCellFormula"
    | "onSetIteration"
    | "onAskMerge"
    | "onUnmerge"
    | "onAskCellNote"
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
> &
  /** Absent while a table is still being read (fieldRenameProblem). */
  Pick<ViewProps, "onRenameField">;

/**
 * The view on screen's callbacks, each dispatching its action. `newId`
 * gives a new row its id, so the reducer stays deterministic. Attaching a
 * file is the app's own (it picks a file and copies it), so it isn't here.
 */
export function viewCallbacks(state: AppState, dispatch: (action: AppAction) => void, newId: () => string): ViewCallbacks {
  return {
    onUpdateRow: (rowId, field, value) => dispatch({ type: "updateRow", rowId, field, value }),
    onSetCellFormula: (rowId, field, expr) => dispatch({ type: "setCellFormula", rowId, field, expr }),
    onSetIteration: (iteration) => dispatch({ type: "setIteration", iteration }),
    onAskMerge: (rowId, field) => dispatch({ type: "askMerge", rowId, field }),
    onUnmerge: (rowId, field) => dispatch({ type: "unmerge", rowId, field }),
    onAskCellNote: (rowId, field, note) => dispatch({ type: "askCellNote", rowId, field, ...(note !== undefined ? { note } : {}) }),
    onUpdateField: (name, patch) => dispatch({ type: "updateField", name, patch }),
    ...(state.tables[state.active] && !state.tables[state.active]!.loading ? { onRenameField: (name: string, to: string) => dispatch({ type: "renameField", name, to }) } : {}),
    onAddEnumValue: (name, value) => dispatch({ type: "addChoice", name, value }),
    onRemoveEnumValue: (name, value) => dispatch({ type: "removeChoice", name, value }),
    onDeleteField: (name) => dispatch({ type: "deleteField", name }),
    onMoveField: (name, delta) => dispatch({ type: "moveField", name, delta }),
    onRestoreSchema: (schema) => dispatch({ type: "restoreSchema", schema }),
    onAddField: (field, place) => dispatch({ type: "addField", field, place }),
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

/**
 * Whether a table can be edited yet: not while its rows are still being
 * read, whether into memory (`loading`) or into its index (`reading`, the
 * indexed tables' build). The one flag every screen greys out its editing by.
 */
export function isEditable(table: ParsedTable | undefined, reading = false): boolean {
  return !!table && !table.loading && !reading;
}
