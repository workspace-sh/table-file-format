# Architecture

How the code is organised and the design choices that drove the
layout. The format spec (docs/SPEC.md) is the contract; this document
explains the implementation that consumes it.

## Repo layout

```
.
├── packages/
│   ├── core/                @workspace.sh/table-core
│   │                        Pure-TS format library — parser, writer,
│   │                        validator, query, manifest stamping,
│   │                        nanoid generation, CSV converter,
│   │                        indexer stubs.
│   │                        Cross-platform (Node + RN + browser).
│   │
│   ├── ui/                  @workspace.sh/table-ui
│   │                        Cross-platform view components built on
│   │                        react-strict-dom: TableView, BoardView,
│   │                        GalleryView, ListView, CalendarView,
│   │                        SchemaFieldEditor, BodyEditor.
│   │                        Renders identically on web (via createPortal
│   │                        + DOM) and native (via the context-based
│   │                        PortalHost — RN's Modal crashes on macOS).
│   │
│   └── table-fixtures/      @workspace.sh/table-fixtures
│                            Inline JS copies of fixtures/*.table/
│                            (projects + tasks) for consumers that
│                            can't load arbitrary files from disk
│                            (Metro). Web loads the on-disk fixtures
│                            directly via Vite.
│
├── apps/
│   ├── web/                 @workspace.sh/table-web
│   │                        Vite 7 + React 19 + RSD 0.0.55 + StyleX
│   │                        (PostCSS). Full demo with editing,
│   │                        drag-and-drop, search, body editor.
│   │
│   ├── mobile/              @workspace.sh/table-mobile
│   │                        Expo 55 — iOS + Android. CNG-generated
│   │                        ios/ + android/ via `mobile:prebuild`.
│   │                        Consumes the same UI package as web.
│   │
│   └── desktop/             @workspace.sh/table-desktop
│                            Bare RN + react-native-macos 0.81.
│                            macos/ Xcode project committed; Pods/
│                            and build/ gitignored. Standalone —
│                            NOT a workspace member; see "Why desktop
│                            is standalone" below.
│
├── fixtures/
│   ├── projects.table/      17 rows, 9 views, 4 bodies
│   └── tasks.table/         8 rows, cross-table relation to projects
│
├── docs/
│   ├── SPEC.md              Format specification (the contract)
│   ├── ARCHITECTURE.md      This file
│   ├── DECISIONS.md         Settled design choices + their rationale
│   └── STORAGE-AND-SYNC.md  Consumer guidance — SQLite cache, sync
│                            model, the Postgres question
│
└── package.json             Root: workspaces + namespaced scripts
```

Apps consume packages via the workspace alias (`"@workspace.sh/table-core": "*"`)
or via `file:` refs (apps/desktop only). NPM resolves locally — no
publishing required for local development.

## Monorepo shape — npm workspaces

The root `package.json` declares `workspaces: ["packages/*", "apps/web",
"apps/mobile"]`. **`apps/desktop` is deliberately not in the workspaces
array** (see below).

All scripts are namespaced at the root (`core:test`, `web:build`,
`mobile:ios`, `desktop:macos`, etc.) so the syntax is the same across
every surface. Avoid bare lifecycle names (`test`, `start`) at the
root — npm 11 propagates them to every workspace and fails on
workspaces that don't define them.

### Why apps/desktop is standalone

Bare React Native (the macOS app uses `react-native-macos`, not Expo)
doesn't compose cleanly with npm workspace hoisting. RN-macOS's
generated Xcode build phases (notably the hermes-engine "Replace
Hermes" script) hardcode `${PODS_ROOT}/../../node_modules/X` paths
that assume a per-app `node_modules/`. In a workspaces monorepo,
those packages hoist to the repo root and the hardcoded paths break.

The fix is to take `apps/desktop` out of the workspaces array and let
it manage its own dependency tree:

- Its own `node_modules/` and `package-lock.json`
- `@workspace.sh/*` cross-package deps via `file:../../packages/*`
  refs (npm 9+ symlinks `file:` deps by default, so live edits in
  `packages/*/src/` still propagate to desktop)
- Bootstrap via `npm run desktop:install` (= `cd apps/desktop && npm
  install`) in addition to root `npm install`

Mirrors what other workspace-sh repos with bare-RN consumers do.

## Core library — `@workspace.sh/table-core`

### Browser-safe barrel, Node-only IO

`packages/core/src/index.ts` re-exports everything that runs in any
environment: types, `id` (nanoid generator), `validate`,
`validateBodies`, `applyFilters`, `applySort`, `applyGroup`,
`applyView`, `searchRows`, `effectiveAlign`, `defaultAlignFor`, and
the `indexer` stubs.

`parser.ts` and `writer.ts` are **deliberately omitted from the
barrel**. They import `node:fs` and would break in the browser. Node
consumers import them directly via the package's exports map:

```ts
import { parseTable } from "@workspace.sh/table-core/parser";
import { writeTable } from "@workspace.sh/table-core/writer";
```

The apps never import them — they consume fixtures via Vite's
`import.meta.glob` (web), inline JS (mobile + desktop via
`@workspace.sh/table-fixtures`), or in-memory state.

### Type strategy

Schemas, views, rows, fields all live in `packages/core/src/types.ts`
as plain TypeScript interfaces. The query and validator functions
take those types and return plain values — no classes, no factories,
no decorators. Format-as-data first; types describe the data.

### Test runner

`node:test` + `node:assert/strict`, run via `tsx`:

```sh
npm run core:test          # all tests
npm run core:test:watch    # watch mode
```

Tests cover parser round-trip, validator behaviour, query semantics
(filter / sort / group / view / search), nanoid uniqueness, writer
manifest stamping, and CSV round-trip + edge cases. No Jest, no
Vitest. Tests live alongside source as `*.test.ts`.

## UI library — `@workspace.sh/table-ui`

### Cross-platform via react-strict-dom

Every component uses RSD's strict subset (`html.div`, `html.span`,
`html.button`, `html.input`, `html.select`, etc.) and `css.create()`
for styling. Same component code renders to DOM on web (via
react-dom) and to RN primitives on native.

Constraints inherited from RSD's strict subset:

- **No `html.table`** — doesn't exist on RN. Tables render as nested
  flex `<html.div>`s.
- **No CSS Grid** — RN doesn't support it. Flex only.
- **No raw `@stylexjs/stylex`** — always go through `css.create` from
  `react-strict-dom` so the styles compile to RN-native primitives.
- **Explicit `display: "flex"`** on every flex container. RSD on web
  does not auto-set it (only on native does the equivalent kick in).

### Cross-platform internals — `.ts` + `.web.ts` file-split

`packages/ui/src/internal/` contains primitives that need different
implementations per platform:

| File | Native impl | Web impl |
|---|---|---|
| `Portal.tsx` | Context-based `PortalHost` slot (RN `Modal` throws `createNode` on macOS) | `createPortal(children, document.body)` |
| `useViewportWidth.ts` | `useWindowDimensions` from RN | `window.innerWidth` + resize listener |
| `useContainerWidth.ts` | `onLayout` measure | `ResizeObserver` |
| `measureAnchor.ts` | `View.measure` (async callback) | `getBoundingClientRect` (sync, wrapped in `Promise.resolve`) |
| `useFocused.ts` | (single file — pure React state, works on both) | — |
| `calendarLocale.ts` | (single file — `Intl.DateTimeFormat` + `Intl.Locale.getWeekInfo`) | — |

Vite's `resolve.extensions` is configured to prefer `.web.*` ahead of
bare extensions; Metro's standard resolution does the same with
`.native.*`. We use the bare `.ts` / `.tsx` as the native default and
add `.web.ts` / `.web.tsx` overrides where needed. Consumers import
once (e.g. `import { Portal } from "./internal/Portal"`); each
bundler picks the right variant automatically.

### Why fixed-width table cells

RSD on RN inside a horizontal `<ScrollView>` cannot enforce cross-row
column alignment via flex distribution. Yoga (RN's layout engine)
doesn't propagate `align-items: stretch` to children when the parent
has an indefinite cross-axis (which is the case inside an unbounded
ScrollView). Tested empirically with four different flex
strategies — none worked.

The answer is fixed pixel widths per cell, computed at render time
from the container width. Same approach Airtable, Notion, and Linear
use. The width model (in `packages/ui/src/views.tsx`, applied per
cell via the `cellWidth(n)` function-style):

1. Reserve fixed-width chrome up front — the "+ Field" trailing slot
   (`ADD_FIELD_COLUMN_WIDTH`) and the table's own borders — then
   divide the remainder by the DATA column count only.
2. If the per-column share is below `MIN_CELL_WIDTH`, columns clamp
   to the minimum and the pane scrolls horizontally.
3. Otherwise the `floor()` remainder is handed out one pixel at a
   time to the leftmost columns so columns sum EXACTLY to the
   available width — no dead strip at the right edge, headers and
   body rows always share identical geometry.

CalendarView applies the same remainder-distribution to its 7-column
grid (`dayColWidth(colIndex)`).

## Apps

### Web — `apps/web`

Vite 7 + React 19 + react-strict-dom + StyleX (PostCSS plugin) +
vite-plugin-babel for processing the RSD babel preset across both
user code and `node_modules`. Fixture loading via Vite's
`import.meta.glob` against the on-disk `fixtures/projects.table/`.

Build pipeline mirrors `facebook/react-strict-dom/apps/vite-app`:

1. `@vitejs/plugin-react` with `babel: { configFile: true }` reads
   `babel.config.js` for the user code.
2. `vite-plugin-babel` applies the same babel config to
   `node_modules` files (so RSD's own `stylex.create()` calls get
   compiled).
3. `babel.config.js` uses `react-strict-dom/babel-preset`, which
   internally configures `@stylexjs/babel-plugin` with
   `importSources: [{ from: "react-strict-dom", as: "css" }]` so
   `css.create()` calls are recognised as StyleX entry points.
4. `postcss.config.js` invokes `react-strict-dom/postcss-plugin`,
   which scans source files (re-runs babel internally) and writes the
   collected CSS rules.

### Mobile — `apps/mobile`

Expo 55 + RN 0.83. CNG (Continuous Native Generation): `ios/` and
`android/` directories are gitignored and regenerated from
`app.json` + `babel.config.js` + the Expo config plugins via
`mobile:prebuild`.

Metro config has a `blockList` that hides hoisted-to-root copies of
`react` / `react-native` (workspace hoisting can put duplicates in
both apps/mobile/node_modules and the root node_modules; the
blockList forces Metro to use the app-local copy and avoid
dual-React-instance bugs).

### Desktop — `apps/desktop`

Bare RN + `react-native-macos` 0.81. The `macos/` Xcode project is
committed (bare RN — not CNG). Initial setup mirrors
`react-native-source-editor/example/macos-app/` with rename sweeps to
`TableDesktop` + bundle id `sh.workspace.table.desktop`.

Podfile uses `react_native_pods.rb` from
`react-native-macos` with a `ws_dir` walk-up so it finds the macOS RN
fork in the right place inside the monorepo. Includes the
Xcode 26 / Apple Clang 17 `fmt` consteval workaround.

## Platform realities — "a directory that IS a file"

The `.app`-bundle model works everywhere, but "IS a file" carries
platform caveats consumers should plan for rather than discover:

- **macOS**: presenting a `.table/` as a single Finder item needs the
  consuming app to declare the extension as a document package (UTI
  conforming to `com.apple.package`). Without that it's just a folder
  — still fully functional, just not one-item-shaped.
- **iOS**: directory documents are second-class in the Files app and
  file-provider APIs compared to flat files; expect extra
  `NSFileCoordinator` care in a document-based app.
- **Android**: Storage Access Framework hands out tree URIs, not
  paths — readers must be written against SAF documents, not `fs`.
- **Transport**: email/upload flows flatten or reject directories;
  the interchange convention is `projects.table.zip` — canonical
  layout, security rules, and the reference reader/writer are in
  SPEC section 13 (`@workspace.sh/table-core/archive`).
- **Git on case-insensitive filesystems**: checkout behaviour for
  case-colliding paths feeds the row-id rules in SPEC section 3.

None of these blocks the model; all of them shape consuming-app work.

## Build outputs

- `packages/core/dist/` — TypeScript compilation of the format
  library (`tsc`). The package's `main` and `types` point inside this.
- `dist-web/` — Vite production build of the web app.
- `apps/mobile/ios/` + `apps/mobile/android/` — Expo CNG outputs.
- `apps/desktop/macos/build/` — Xcode build output.

All gitignored.

## Workflow

- Default branch: `develop`. Never push directly.
- Topic branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`,
  `chore/<slug>`. Land via PR into `develop`.
- Open spec questions and design decisions get filed as GitHub issues
  for visibility (rather than parked only in chat or memory).
- Settled design choices get an entry in `docs/DECISIONS.md`.
