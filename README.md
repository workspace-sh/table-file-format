# `.table/`

An open, app-agnostic file format for what Airtable, Google Tables, and
Obsidian Bases do — a portable database that's also kind of a
spreadsheet, for information workers, not developers.

A `.table/` is a directory that IS a file (like macOS `.app` bundles).
Plain text inside, line-diffable, greppable, self-contained.

> **Status:** spike / research. The format and reference library are
> usable; the API is unstable and the spec will move. Not for production
> data yet.

## What's in a `.table/`

```
my-data.table/
├── schema.json          required — typed fields, constraints, version
├── rows.ndjson          required — one JSON record per line, every row
│                                   carries a system `id` (nanoid)
├── views.json           optional — saved views (table/board/gallery/list/calendar)
├── meta.json            optional — manifest, title, timestamps, generator
├── attachments/         optional — files referenced by row values
├── bodies/              optional — long-form markdown bodies, one per row
│   └── {row.id}.md
└── index.sqlite         optional — rebuildable query/search cache (gitignored)
```

See [docs/SPEC.md](docs/SPEC.md) for the full format specification.

## Why

Information workers move structured data between tools. Today that
means CSV (lossy, untyped), `.xlsx` (binary, app-locked), `.numbers`
(Apple-only), Airtable / Notion / Google Tables (cloud-locked). None of
these are *open*, *typed*, *line-diffable*, AND *self-contained*.

`.table/` aims for: open, typed, line-diffable, self-contained, and
expressive enough to round-trip a real Airtable base — multiple views,
relations between tables, attachments, schema versioning, optional
long-form markdown bodies per row.

## Quick example

```ts
import { parseTable, applyView, validate } from "@workspace.sh/table-core";

const projects = await parseTable("./projects.table");

// Validate against the schema
const errors = validate(projects.schema, projects.rows);
if (errors.length) console.error(errors);

// Apply a saved view (filter + sort)
const view = projects.views.find((v) => v.name === "Active by priority")!;
const visibleRows = applyView(projects, view);

// Read a row's optional long-form body
const body = projects.bodies?.[visibleRows[0]!.id];
```

## Repo layout — NPM workspace monorepo

```
.
├── packages/
│   ├── core/             @workspace.sh/table-core
│   │                     pure-TS format library — parser/writer/validator/query/
│   │                     id/indexer-stubs. Cross-platform (Node + RN + browser).
│   └── ui/               @workspace.sh/table-ui
│                         RSD/StyleX view components — TableView, BoardView,
│                         GalleryView, ListView, CalendarView, SchemaEditor,
│                         BodyEditor.
│                         Currently web-targeted; cross-platform lifting tracked.
├── apps/
│   ├── web/              @workspace.sh/table-web
│   │                     Vite 7 + React 19 + RSD 0.0.55 + StyleX (PostCSS).
│   │                     Full demo with editing, drag-and-drop, search, etc.
│   ├── mobile/           @workspace.sh/table-mobile
│   │                     Expo 55 — iOS + Android. Minimal list viewer.
│   │                     `npm run mobile:prebuild` to generate native projects.
│   └── desktop/          @workspace.sh/table-desktop
│                         Bare RN + react-native-macos 0.81. Minimal viewer.
│                         `macos/` Xcode project inside (gitignored,
│                         bootstrap per README).
├── fixtures/
│   ├── projects.table/   7 rows, 9 views, one body
│   └── tasks.table/      8 rows, cross-table relation to projects
└── docs/
    ├── SPEC.md
    ├── ARCHITECTURE.md
    └── DECISIONS.md
```

Apps consume packages via the workspace alias (`"@workspace.sh/table-core": "*"`);
NPM resolves locally. No publishing required for local development.

## Running

Pinned to Node 22.20.0 via `.nvmrc` (matches the rest of the
workspace-sh org). If your nvm/fnm auto-switches on cd, you don't have
to think about it.

All commands run from the monorepo root. Namespaced consistently so the
syntax is the same across every surface.

```sh
npm install                       # installs everything; symlinks workspace packages

# Format library
npm run core:build                # tsc → packages/core/dist/
npm run core:test                 # node:test suite (48 tests)
npm run core:test:watch           # watch mode
npm run core:typecheck

# Web (full demo)
npm run web:dev                   # vite at http://localhost:5173
npm run web:build                 # production bundle
npm run web:preview               # preview the built bundle
npm run web:typecheck
npm run dev                       # alias for `web:dev`

# Mobile (Expo 55, iOS + Android — Metro on port 8082)
# Expo's `run:ios` / `run:android` start Metro themselves; no concurrency needed.
npm run mobile:prebuild           # generate ios/ + android/ via CNG
npm run mobile:start              # expo start --dev-client --port 8082
npm run mobile:clear              # watchman watch-del-all + expo start --clear
npm run mobile:ios                # expo run:ios on simulator (starts Metro)
npm run mobile:ios:device         # expo run:ios --device
npm run mobile:ios:device:release # expo run:ios --device --configuration Release
npm run mobile:android            # expo run:android on emulator (starts Metro)
npm run mobile:android:device     # expo run:android --device
npm run mobile:typecheck

# Desktop (bare RN + react-native-macos, Metro on port 8083)
# Bare RN needs Metro + run-macos as separate processes — :dev handles both.
# First time: bootstrap the native macos/ Xcode project — see
# apps/desktop/README.md (mirror react-native-source-editor's setup).
npm run desktop:pods              # cd macos && pod install
npm run desktop:start             # start --reset-cache (port 8083)
npm run desktop:start:clean       # watchman clear + start --reset-cache
npm run desktop:macos             # react-native run-macos --port 8083
npm run desktop:dev               # concurrently: start:clean + macos
npm run desktop:typecheck

# UI package — typecheck only (no runtime; it's a library of components)
npm run ui:typecheck
```

> **Heads-up on npm 11 + workspaces:** lifecycle script names (`test`,
> `build`, `start`) propagate to every workspace by default, which fails
> on workspaces that don't define them. That's why root scripts are
> namespaced (`core:test`, not `test`). Avoid running bare `npm test` /
> `npm build` / `npm start` at the root — use the namespaced commands.

## Status

**Settled** (in code and tests):
- Format extension (`.table`), directory layout, NDJSON rows, system ids
- Per-field `relation` for cross-table links (no `foreignKeys`)
- Manifest fields (`format`, `formatVersion`) stamped on writes
- Append-only schema evolution; `schema-version` field
- Sort respects enum declaration order; nulls last regardless of direction
- Group buckets nulls into `"(empty)"`; keys ordered by enum when present
- Optional `bodies/{id}.md` for long-form markdown bodies
- `format: "markdown"` annotation for inline markdown content

**Stubs** (interface locked, implementation deferred):
- `index.sqlite` cache: `buildIndex` / `queryIndex` / `isIndexStale` / `dropIndex`

**Open** (tracked as issues):
- Cross-table relation drilldown (#3)
- Markdown ↔ `.table/` cross-reference addressing (#4)
- CSV converter (`fromCSV` / `toCSV`) (#5)
- `index.sqlite` cache implementation (#6)
- Granular parser/writer/validator named exports (#7)
- Lift `@workspace.sh/table-ui` from web-only to cross-platform
  (replace `react-dom/createPortal`, abstract `document.pointermove`,
  pseudo-state styles → `useFocused`-style hooks)

**Deliberately deferred** (no spec, no plan):
- Data versioning — undo/redo, edit history, real-time collaboration,
  audit trails. Git is the format's version-control substrate by
  design; everything else is the consuming app's concern. A future
  optional `history.ndjson` extension is reserved but not specified.
  See [docs/DECISIONS.md D14](docs/DECISIONS.md) for the full
  rationale and Workspace-specific guidance.

## Spike, not product

This is a research spike inside the
[Workspace](https://github.com/workspace-sh) product family — local-first
markdown for information workers. The format is intended to be
genuinely open and app-agnostic; the reference viewer doubles as a
[react-strict-dom](https://github.com/facebook/react-strict-dom)
playground for Workspace's UI direction. Names, internals, and APIs
will move until 1.0.
