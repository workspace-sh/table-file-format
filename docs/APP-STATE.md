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
| `mode`, `shownFile`, `openedDirs` | three copies | `withFileUnfolded`, `withFileToggled` |
| `sidebar` (prefs) | three copies | `sidebarPrefs` |
| `history` | Mac, Linux | `visited`, `goBack`, `goForward` |
| `arrangements` | three copies | `arrange`, `reset`, `savingForEveryone`, `forViews` |
| `display` | three copies | `withDisplayChoice` |
| `search`, `settingsOpen` | three copies, with `leaving` | cleared or closed by `leaving` |
| `dirty` (bundles to write) | Linux (ref), web and Mac (effects) | every edit marks its bundle |

**Out of it**, staying in each app:
- **Drawing**: views, dialogs and the sidebar are table-ui and table-gtk.
- **Asking**: an action that needs a question doesn't happen until the answer comes back. The reducer only holds the pending question as data (a `Confirm`, a `NamePrompt`), and the app shows it its own way: `window.confirm`, an `Alert`, an `AdwAlertDialog`.
- **Storing and writing**: where prefs, arrangements and display settings are kept (browser storage, the Mac's native store, `settings.json`), and how dirty bundles are written (the web's saved tables, the Mac's store and folders, Linux's `saveBundle`).
- **Choosing files**: file pickers, and reading or writing bytes on disk.

## Shape

```ts
// packages/app/src/appState.ts — pure, no React.
export interface AppState {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  active: string;                     // table key on screen
  viewIds: Record<string, string>;    // each table's view
  openPage: string | null;            // row id, in `active`
  mode: "tables" | "files";
  shownFile: ShownFile | null;
  openedDirs: Record<string, boolean>;
  sidebar: SidebarPrefs;
  history: History;
  arrangements: Arrangements;
  display: DisplaySettings;
  search: string;
  settingsOpen: boolean;
  asking: Asking | null;              // a question the app is to show
  dirty: string[];                    // bundle keys to write
}

export type AppAction =
  | { type: "showTable"; key: string }
  | { type: "showView"; key: string; viewId: string }
  | { type: "follow"; target: AddressTarget }           // relation, address
  | { type: "back" } | { type: "forward" }
  | { type: "edit"; key: string; change: (t: ParsedTable) => ParsedTable }
  | { type: "addView"; key: string }                    // opens its settings
  | { type: "ask"; asking: Asking } | { type: "answer"; response: string }
  | { type: "made"; made: Made }                        // creating's result
  | { type: "opened"; library: Library }                // a folder or archive
  | { type: "reset"; fresh: Library; kept: string[] }
  | { type: "arrange"; patch: Partial<View> } | { type: "saveForEveryone" } | { type: "resetArrangement" }
  | { type: "setMode"; mode: "tables" | "files" } | { type: "toggleFile"; bundle: string }
  | { type: "setSidebarCollapsed"; collapsed: boolean }
  | { type: "showFile"; file: ShownFile | null } | { type: "toggleDir"; id: string; open: boolean }
  | { type: "search"; text: string } | { type: "settings"; open: boolean }
  | { type: "openPage"; rowId: string | null }
  | { type: "display"; choice: DisplayChoice }
  | { type: "written"; bundles: string[] };             // dirty bundles saved

export function tableApp(state: AppState, action: AppAction): AppState;
export function initialAppState(input: { tables; bundles; stored: StoredPrefs; start?: Address }): AppState;
```

Four rules live in the reducer, not in the apps:
- **Leaving a view.** After every action, if `active` or its view changed (`leaving`), `search` clears and `settingsOpen` closes. `addView` is the one exception: it opens the new view's settings.
- **Recording history.** After every action, the view on screen is passed to `visited`, and `back` and `forward` skip dead entries (`addressLive`). The apps stop recording views themselves.
- **Unfolding the file on screen.** When `active` changes, its file unfolds (`withFileUnfolded`).
- **Questions.** An action that needs one first sets `asking`, and the actual change waits for `answer`: deleting a row (`deletingRow`), deleting a view (`deletingView`), turning off a sheet (`viewPatchPrompt`), and resetting (`resetPrompt`).

**Selectors** (pure): `derive(state, platform)` returns what the drawing needs: `table`, `view`, the shown view (`showView`, with this viewer's arrangement and search), `viewSummary`, `tableBreadcrumb`, the sidebar entries (`sidebarTree` flattened, or `filesTree`), and `appCommands` with their enabled state.

**React binding**: `@workspace.sh/table-app/react` exports `useTableApp(initial, adapter)`, which wraps `useReducer` plus the effects every app writes today:
- saving `sidebar`, `arrangements` and `display` through `adapter.store`, a `KeyValueStore`;
- calling `adapter.write(dirty)` a moment after the last edit, then dispatching `written`.

React becomes a peer dependency of that subpath only. The core stays renderer-free and React-free.

## How we get there

Each step lands on develop working, and the web stays pixel-identical at every step.

1. **The reducer and selectors, in table-app, with no app changes.** Tests go action by action, especially the four rules above.
2. **Linux adopts it.** Its `App.tsx` has the fewest special cases and the strictest tests (80, each mutation-checked), so it proves the reducer against a real app and shows whether GTKX needs anything different. The Linux tests must pass unchanged.
3. **The web adopts it, then the Mac.** Each app keeps its own drawing and question handling.
4. **`useTableApp`**, once three apps share the same effects, rather than guessing them up front.

**Not in scope**: the web's hash sync, the URL scheme, and multi-window. These can build on the reducer later.
