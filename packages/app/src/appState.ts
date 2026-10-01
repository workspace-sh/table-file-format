// Everything an app around the .table views holds, and every change to it,
// as one reducer (docs/APP-STATE.md): which table and view are on screen,
// the tables themselves and the edits made to them, this viewer's own
// arrangements and settings, and the questions to ask before a change
// that can't be undone. Pure, as the rest of table-app is: no React, no
// renderer, no storage. Each app draws what `derive` gives it, shows
// `asking` and `telling` its own way, and writes the bundles in `dirty`.

import { isSheet, textDirection, type Address, type BundleMeta, type Field, type ParsedTable, type View } from "@workspace.sh/table-core";
import { canInsertAt, type DisplaySettingKind, type DisplaySettings, type ViewProps } from "@workspace.sh/table-ui/shared";

import { arrange, arrangedView, isArranged, reset as resetArrangement, savingForEveryone, type Arrangement, type Arrangements } from "./arrangements.ts";
import { tableBreadcrumb, type Breadcrumb } from "./breadcrumb.ts";
import { addressTarget, applyTarget, bundleOf, type AddressTarget } from "./bundles.ts";
import { appCommands, type AppCommand } from "./commands.ts";
import { CANCEL, type Confirm } from "./confirm.ts";
import { creating, namePrompt, newView, type Making, type NamePrompt } from "./creating.ts";
import { viewerLocale, viewerOrder, withDisplayChoice } from "./displaySettings.ts";
import {
  deletingRow,
  deletingView,
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
import { addressLive, goBack, goForward, NO_HISTORY, viewAddress, visited, type History } from "./history.ts";
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
  arrangements: Arrangements;
  display: DisplaySettings;
  search: string;
  settingsOpen: boolean;
  asking: Asking | null;
  telling: Telling | null;
  /** Bundles edited since they were last written. */
  dirty: string[];
}

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
  | { type: "search"; text: string }
  | { type: "settings"; open: boolean }
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
  | { type: "addChoice"; name: string; value: string }
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
  | { type: "written"; bundles: string[]; tables?: Record<string, ParsedTable> };

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
    arrangements: input.stored?.arrangements ?? {},
    display: input.stored?.display ?? {},
    search: "",
    settingsOpen: false,
    asking: null,
    telling: null,
    dirty: [],
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
  if (tableChanged) next = { ...next, sidebar: withFileUnfolded(next.sidebar, bundleOf(next.active)) };
  if (next.tables[next.active]) {
    const history = visited(next.history, viewAddress(next.active, toView));
    if (history !== next.history) next = { ...next, history };
  }
  return next;
}

/** An edit to the table on screen: made, and its bundle marked to write. Nothing when it changes nothing. */
function edit(state: AppState, change: (table: ParsedTable) => ParsedTable, key = state.active): AppState {
  const tables = onTable(state.tables, key, change);
  return tables === state.tables ? state : { ...state, tables, dirty: marked(state.dirty, bundleOf(key)) };
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

function moved(state: AppState, to: { history: History; address: string } | null): AppState {
  if (!to) return state;
  const target = addressTarget(to.address, state.tables, state.bundles, bundleOf(state.active));
  // History is of views: its addresses name no row, so a page open is left behind.
  return target ? { ...follow(state, target), history: to.history } : state;
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
      return moved(state, goBack(state.history, (a) => addressLive(a, state.tables, state.bundles)));
    case "forward":
      return moved(state, goForward(state.history, (a) => addressLive(a, state.tables, state.bundles)));
    case "openPage":
      if (action.rowId !== null && !state.tables[state.active]?.rows.some((r) => r.id === action.rowId)) return state;
      return action.rowId === state.openPage ? state : { ...state, openPage: action.rowId };
    case "search":
      return action.text === state.search ? state : { ...state, search: action.text };
    case "settings":
      return action.open === state.settingsOpen ? state : { ...state, settingsOpen: action.open };

    case "updateRow":
      return edit(state, (t) => withCell(t, action.rowId, action.field, action.value));
    case "addRow":
      return edit(state, (t) => withRow(t, action.id));
    case "insertRow": {
      // Only in a Sheet view whose order isn't decided by a sort (D41).
      const view = currentView(state);
      if (!view || !isSheet(view) || !canInsertAt(view)) return state;
      return edit(state, (t) => withRowAt(t, view.id, action.anchor, action.where, action.id));
    }
    case "deleteRow": {
      const table = state.tables[state.active];
      if (!table?.rows.some((r) => r.id === action.rowId)) return state;
      const { prompt } = deletingRow(table, action.rowId, state.openPage);
      return { ...state, asking: { kind: "confirm", confirm: prompt, on: { type: "deleteRow", key: state.active, rowId: action.rowId } } };
    }
    case "updateBody":
      return edit(state, (t) => withBody(t, action.rowId, action.content), action.table);
    case "updateField":
      return edit(state, (t) => withFieldPatch(t, action.name, action.patch));
    case "addField":
      return edit(state, (t) => withField(t, action.field, viewIdOf(state, state.active)));
    case "moveField":
      return edit(state, (t) => withFieldMoved(t, action.name, action.delta));
    case "addChoice":
      return edit(state, (t) => withChoice(t, action.name, action.value));
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
  }
}

function answered(state: AppState, asking: Asking, action: { response: string; text?: string }): AppState {
  const on = asking.on;
  if (action.response === CANCEL.id) return state;
  if (asking.kind === "confirm" && !asking.confirm.responses.some((r) => r.id === action.response)) return state;
  switch (on.type) {
    case "deleteRow":
      // Its page, if open, goes with it (settle's rule).
      return edit(state, (t) => withoutRow(t, on.rowId), on.key);
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
          bundles: after.bundles,
          openedAt: schemaVersions(after.tables),
          viewIds: firstViews(after.tables),
          history: NO_HISTORY,
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
  commands: AppCommand[];
  /** The address of what's on screen, with the open page's row: Copy Link's. */
  address: string;
}

export function derive(state: AppState, options: DeriveOptions = {}): Derived {
  const table = state.tables[state.active] ?? NO_TABLE;
  const viewId = viewIdOf(state, state.active);
  const view = table.views.find((v) => v.id === viewId) ?? table.views[0] ?? NO_TABLE.views[0]!;
  const arrangement = state.arrangements[state.active]?.[view.id];
  const locale = viewerLocale(state.display, options.locale);
  const held = state.tables[state.active] !== undefined;
  const shown: ShownView = held
    ? showView(state.tables, state.active, view, { arrangement, search: state.search, viewerText: viewerOrder(locale) })
    : { view: arrangedView(view, arrangement), rows: [], inView: 0 };
  const live = (a: string) => addressLive(a, state.tables, state.bundles);
  const canGoBack = goBack(state.history, live) !== null;
  const canGoForward = goForward(state.history, live) !== null;
  const mode = state.sidebar.files ? "files" : "tables";
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
    summary: viewSummary(table, {
      shown: shown.rows.length,
      inView: shown.inView,
      searching: state.search.trim().length > 0,
      openedAt: state.openedAt[state.active],
    }),
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
    commands: appCommands({ sidebarCollapsed: state.sidebar.collapsed === true, filesMode: mode === "files", canGoBack, canGoForward }),
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
    | "onMoveField"
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
    onMoveField: (name, delta) => dispatch({ type: "moveField", name, delta }),
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
