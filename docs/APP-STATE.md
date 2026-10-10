# App state: one reducer for every demo app

The web demo, the macOS app and the Linux app each hold the same state and
wire it to table-app the same way: about 1,000 lines of `App.tsx` each,
most of it `useState` setters around pure table-app calls. This page is
the shape that state takes once, in table-app, so each app keeps only
what's its own: how it draws, where it stores things, and how it asks
questions.

All three apps are React (react-strict-dom on the web and the Mac, GTKX
on Linux), so a React binding can be shared too. But the core is a pure
reducer, testable without any renderer, as the rest of table-app is.

## What moves

**Into the reducer (`tableApp(state, action)`)**: the state every app
holds, and the rules that already live in table-app, applied in one place:

| State | Today | Rules applied |
|---|---|---|
| `tables`, `bundles` | three copies | `onTable`, the `with*` edits, `creating`, `openArchive`, `afterReset` |
| `active`, `viewIds` | three copies | `firstTableKey`, `firstViews`, `applyTarget`, `leaving` |
| `openPage` (row whose page is open) | three copies | `deletingRow.closeBody`, `applyTarget.openBody` |
| `opened` (bundle → where it came from on disk) | Mac (`useFolders`), Linux (`paths`) | reset keeps these; the breadcrumb names them; attachments come from disk |
| `shownFile`, `openedDirs` (the Files side is `sidebar.files`) | three copies | `withFileUnfolded`, `withFileToggled` |
| `sidebar` (prefs) | three copies | `sidebarPrefs` |
| `history` | Mac, Linux | `visited`, `goBack`, `goForward` |
| `arrangements` | three copies | `arrange`, `reset`, `savingForEveryone`, `forViews` |
| `display` | three copies | `withDisplayChoice` |
| `search`, `settingsOpen` | three copies, with `leaving` | cleared or closed by `leaving` |
| `dirty` (bundles to write) | Linux (ref), web and Mac (effects) | every edit marks its bundle |
| `asking`, `telling` | three copies, each its own way | `deletingRow`, `deletingView`, `viewPatchPrompt`, `resetPrompt`, `namePrompt`; `importSkippedText`, `openFailedText`, `exportFailedText` |

**Out of it**, staying in each app:
- **Drawing**: views, dialogs and the sidebar are table-ui and table-gtk.
- **Showing questions and messages**: the reducer holds the pending question (`asking`: a `Confirm` or a `NamePrompt`) and any one-way message (`telling`) as data. Each app shows them its own way (`window.confirm`, an `Alert`, an `AdwAlertDialog`) and dispatches `answer` or `told`.
- **Storing and writing**: where prefs, arrangements and display settings are kept (browser storage, the Mac's native store, `settings.json`), and how dirty bundles are written (the web's saved tables, the Mac's store and folders, Linux's `saveBundle`). `opened` locations are opaque to the reducer; the adapter uses them.
- **Choosing files**: file pickers, and reading or writing bytes on disk. What's read comes back as `opened`.
- **Window-size policy**: the narrow layout (the web's drawer, the Mac's collapse when narrow). `toggleSidebar` is the app's to route: a narrow Mac flips its own shown-while-narrow flag instead of dispatching it.

## Shape

```ts
// packages/app/src/appState.ts — pure, no React.
export interface AppState {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  active: string;                     // table key on screen
  viewIds: Record<string, string>;    // each table's view
  openPage: string | null;            // row id, in `active`
  opened: Record<string, string>;     // bundle → its folder on disk; opaque here
  shownFile: ShownFile | null;        // the Files side is sidebar.files
  openedDirs: Record<string, boolean>;
  sidebar: SidebarPrefs;
  history: History;
  arrangements: Arrangements;
  display: DisplaySettings;
  search: string;
  settingsOpen: boolean;
  asking: Asking | null;              // a Confirm or NamePrompt, and what answering does
  telling: { heading: string; body?: string } | null;  // a message the app is to show
  dirty: string[];                    // bundle keys to write
  undo: Record<string, { past: UndoStep[]; future: UndoStep[] }>;  // per table: what it was before each edit
}

export type AppAction =
  // Where you are
  | { type: "showTable"; key: string }
  | { type: "showView"; key: string; viewId: string }
  | { type: "follow"; target: AddressTarget }           // relation, address
  | { type: "back" } | { type: "forward" }
  | { type: "openPage"; rowId: string | null }
  | { type: "search"; text: string } | { type: "settings"; open: boolean }
  // Edits: ViewProps' callbacks, one to one, as data (undo and sync can replay them)
  | { type: "updateRow"; rowId: string; field: string; value: unknown }
  | { type: "addRow"; id: string }                      // the adapter's newId
  | { type: "insertRow"; anchor: string; where: "above" | "below"; id: string }
  | { type: "deleteRow"; rowId: string }                // asks first
  | { type: "updateBody"; rowId: string; content: string }
  | { type: "updateField"; name: string; patch: Partial<Field> }
  | { type: "addField"; field: Field } | { type: "moveField"; name: string; delta: -1 | 1 }
  | { type: "addChoice"; name: string; value: string }
  | { type: "updateView"; patch: Partial<View> }        // asks first when a sheet formulas read goes
  | { type: "addView" } | { type: "deleteView" }        // addView opens its settings; deleteView asks
  | { type: "undo" } | { type: "redo" }                 // the table on screen, back a step and forward again
  // This viewer's own
  | { type: "arrange"; patch: Partial<View> } | { type: "saveForEveryone" } | { type: "resetArrangement" }
  | { type: "display"; choice: DisplayChoice }
  | { type: "setFilesSide"; files: boolean } | { type: "toggleFile"; bundle: string }
  | { type: "setSidebarCollapsed"; collapsed: boolean }
  | { type: "showFile"; file: ShownFile | null } | { type: "toggleDir"; id: string; open: boolean }
  // Files, and questions
  | { type: "create"; making: Making }                  // asks for a name
  | { type: "opened"; library: Library; skipped?: string[] }  // a folder or archive, read by the app
  | { type: "reset"; fresh: Library }                   // asks first; `fresh`: the examples, read by the app
  | { type: "answer"; response: string; text?: string } // a Confirm's response id, or a NamePrompt's text
  | { type: "tell"; message: { heading: string; body?: string } } | { type: "told" }
  | { type: "written"; bundles: string[] };             // dirty bundles saved

export function tableApp(state: AppState, action: AppAction): AppState;
export function initialAppState(input: { tables; bundles; opened?; stored: StoredPrefs; start?: Address }): AppState;
```

Pass `start` only for a link or address being followed (Linux's `--open`, the web's address on load), not to choose the default table. It lands as a followed link does, on the Tables side, so a bare launch that passes it loses a remembered Files side. The first table is `firstTableKey`'s, as it is with no `start`. The web passes its address on every load, since a reload keeps it, so it keeps the remembered side itself.

Five rules live in the reducer, not in the apps:
- **Leaving a view.** After every action, if `active` or its view changed (`leaving`), `search` clears and `settingsOpen` closes. That includes `reset` and `opened`, which change `active`, as the apps do today. `addView` is the one exception: it opens the new view's settings.
- **Recording history.** After every action, the view on screen is passed to `visited`, and `back` and `forward` skip dead entries (`addressLive`). The apps stop recording views themselves.
- **Unfolding the file on screen.** When `active` changes, its file unfolds (`withFileUnfolded`).
- **Questions.** An action that needs one first sets `asking`, and the actual change waits for `answer`: deleting a row (`deletingRow`, which then closes its open page), deleting a view (`deletingView`, which then shows the next view), turning off a sheet that formulas read (`viewPatchPrompt`), resetting (`resetPrompt`, keeping `opened` bundles), and naming what's created (`namePrompt`, then `creating` with the answer's text). The rules each edit already has apply here too: `insertRow` only where `canInsertAt`, and every edit marks its bundle `dirty`.
- **Undo.** Every edit to a table's rows, pages, fields or views keeps the table as it was, per table, newest last: 100 steps, fewer for a long table (20 at 100,000 rows). `undo` puts the last one back on the table on screen and marks its bundle `dirty`; `redo` makes the edit again; a new edit empties what redo had. Where you are (the view, the selection, the search, the page open, this viewer's arrangement) isn't an edit and doesn't go back. Saves of one page while it's typed in are one step, ended when another page opens. `derive` gives `canUndo` and `canRedo`, and the `undo` and `redo` commands (Edit, ⌘Z and ⇧⌘Z) are enabled from them; both are false on the Files side. A text field with the keyboard keeps those keys for its own text. A table held in the index (LARGE-TABLES.md) has its rows there, so only edits to its views are steps, and an edit to its fields lets its earlier steps go. Steps aren't kept past the session, and go when the table is opened again, reset, or read again from disk.

**Selectors** (pure): `derive(state, { platform, locale })` returns (with the platform's locale for `viewerLocale`, the direction and `viewerOrder`) what the drawing needs: `table`, `view`, the shown view (`showView`, with this viewer's arrangement and search), `viewSummary`, `tableBreadcrumb`, the sidebar entries (`sidebarTree` flattened, or `filesTree`), `appCommands` with their enabled state, the mode (from `sidebar.files`), and a `ViewProps`-shaped set of callbacks for the view on screen, each dispatching its named action.

**React binding**: `@workspace.sh/table-app/react` exports `useTableApp(init, adapter, locale?)`. It wraps `useReducer` and runs the effects every app wrote. The adapter is `{ store, write(bundles, tables, metas), delayMs }`. The hook:
- saves `sidebar`, `arrangements` (of views that still exist) and `display` through `adapter.store`, a `KeyValueStore`;
- calls `adapter.write` with the dirty bundles `delayMs` after the last edit, then dispatches `written` with the tables written. A rejection leaves them dirty and shows as `saving`'s failure. `false` means the app held the write back (Linux's reset), and leaves them dirty too.
- returns `{ state, dispatch, display, saving }`, where `display` is the display settings with the direction the viewer's language reads.

Each app still calls `derive` itself, since its options (attachments, file names) depend on its own state. The write scheduling is `scheduleWrite`, a plain function tested without a renderer.

React becomes a peer dependency of that subpath only. The core stays renderer-free and React-free.

## How we get there

Each step lands on develop working, and the web stays pixel-identical at every step.

1. **The reducer and selectors, in table-app, with no app changes.** Tests go action by action, especially the four rules above.
2. **Linux adopts it.** Its `App.tsx` has the fewest special cases and the strictest tests (80, each mutation-checked), so it proves the reducer against a real app and shows whether GTKX needs anything different. The Linux tests must pass unchanged.
3. **The web adopts it, then the Mac.** Each app keeps its own drawing and question handling.
4. **`useTableApp`**, once three apps share the same effects, rather than guessing them up front.

**Not in scope**: the web's hash sync, the URL scheme, and multi-window. These can build on the reducer later.
