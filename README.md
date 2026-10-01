# `.table/`

An open, app-agnostic file format for what Airtable, Google Tables, and
Obsidian Bases do — a portable database that's also kind of a
spreadsheet, for information workers, not developers.

A `.table/` is a directory that IS a file (like macOS `.app` bundles),
holding one or more tables, as a spreadsheet holds sheets.
Plain text inside, line-diffable, greppable, self-contained.

**Try it:** the web demo runs at
[workspace-sh.github.io/table-file-format](https://workspace-sh.github.io/table-file-format/),
built from `develop` on every merge. Edits stay in your browser.

> **Status:** format **frozen at `formatVersion: 1`** (tag
> `format-v1`) — the on-disk format is stable and additive-only from
> here; see docs/SPEC.md. The reference library works and is tested;
> its TypeScript API may still evolve ahead of a 1.0 package release.

## What's in a `.table/`

```
crm.table/
├── meta.json                optional: manifest: title, table order, version
├── tables/                  one directory per table, even if there's one
│   ├── companies/
│   │   ├── schema.json      required: typed fields, constraints, version
│   │   ├── rows.ndjson      required: one JSON record per line, every row
│   │   │                               carries a system `id` (nanoid)
│   │   ├── views.json       optional: saved views (table/board/gallery/list/calendar)
│   │   ├── meta.json        optional: the table's title and description
│   │   ├── attachments/     optional: files referenced by row values
│   │   └── bodies/          optional: long-form markdown bodies, one per row
│   │       └── {row.id}.md
│   └── deals/…
└── index.sqlite             optional: rebuildable query/search cache (gitignored)
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
│   ├── ui/               @workspace.sh/table-ui
│   │                     RSD/StyleX view components — TableView, BoardView,
│   │                     GalleryView, ListView, CalendarView, SchemaEditor,
│   │                     BodyEditor.
│   │                     Cross-platform: the same components render on web,
│   │                     iOS, Android and macOS. Every platform fork lives in
│   │                     `src/internal/` — see "What is platform-specific".
│   │                     `@workspace.sh/table-ui/shared` is its renderer-free
│   │                     half: what a cell shows, column widths, grouping,
│   │                     totals, the props every view takes.
│   ├── gtk/              @workspace.sh/table-gtk
│   │                     The same views for GTK4 + libadwaita on Linux,
│   │                     through GTKX. Same names and props as table-ui;
│   │                     built on table-ui/shared, so both show a table alike.
│   └── app/              @workspace.sh/table-app
│                         What an app around the views does, on any platform:
│                         `bundle/table` keys, what a view shows (`showView`),
│                         a viewer's own arrangements, display settings, saved
│                         state, archives. `./node` opens `.table` folders.
├── apps/
│   ├── web/              @workspace.sh/table-web
│   │                     Vite 7 + React 19 + RSD 0.0.55 + StyleX (PostCSS).
│   │                     Full demo with editing, drag-and-drop, search, etc.
│   ├── mobile/           @workspace.sh/table-mobile
│   │                     Expo 55 — iOS + Android. Same five views, body
│   │                     editor and search as web.
│   │                     `npm run mobile:prebuild` to generate native projects.
│   ├── desktop/          @workspace.sh/table-desktop
│   │                     Bare RN + react-native-macos 0.81. Same five views,
│   │                     body editor and search as web.
│   │                     `macos/` Xcode project inside (gitignored,
│   │                     bootstrap per README).
│   └── linux/            @workspace.sh/table-linux
│                         GTKX (GTK4 + libadwaita): the harness for table-gtk,
│                         reading `.table` folders from disk. Not a root
│                         workspace member, like desktop. See its README.
├── fixtures/             the .table files every demo and test uses (D37)
│   ├── crm.table/        companies, contacts, deals, related to each other
│   ├── household-budget.table/  a budget sheet and a ledger (D41)
│   ├── projects.table/   projects and tasks
│   └── shop.table/       orders, customers, products, order lines
└── docs/
    ├── SPEC.md
    ├── ARCHITECTURE.md
    └── DECISIONS.md
```

Apps consume packages via the workspace alias (`"@workspace.sh/table-core": "*"`);
NPM resolves locally. No publishing required for local development.

## What is platform-specific

The five views, the schema editor and the body editor are written once
and run unchanged on web, iOS, Android and macOS. Nothing in the view
layer branches on platform.

Every fork lives in `packages/ui/src/internal/`, and there are twenty-four
of them. Most are a `.web.tsx` or `.web.ts` override beside a default
that serves native; `Tooltip` is a `.macos.tsx` override beside a
default that serves the rest, `useEscape` and `AttachmentImage` have
both, and `RowActions`, `Select`, `DateInput`, `Toggle` and `Sheet` have
`.ios.tsx` and `.android.tsx` beside their other forks:

| Fork | Why it forks |
|---|---|
| `Portal` (with `PortalHost`) | Overlay hosting. RN's `Modal` crashes on macOS, so native uses a context-based host instead of the DOM's `createPortal`. |
| `BottomSheet` | Presentation differs by convention, not just API. |
| `HScroll`, `SnapHScroll`, `Bleed` | Horizontal scrolling, snap points, and running a sideways scroller out to the page's edges. |
| `DragHandle`, `useDropTargets` | Pointer events vs. gesture handlers. |
| `useHoverHint` | A hint when the pointer rests on something. Native adds nothing, since touch screens don't hover. |
| `Tooltip` | The system tooltip for a plain-text hint, on macOS: AppKit's own, through react-native-macos's `tooltip` View prop. Everywhere else it adds nothing, not even an element; the web has its own hover hint. |
| `useEscape` | Escape as a way out (closing an editor with nothing unsaved). The web hears it on the document; macOS from the text input being typed in, which reports it as the escape character; touch screens have no Escape key, so there it adds nothing. |
| `AttachmentImage` | An attachment drawn as an image. React Native's decoders on iOS and Android don't read SVG, so there an `.svg` is drawn by react-native-svg; the web and macOS draw every image themselves (macOS's decoder is patched to hand SVG to NSImage, and react-native-svg draws nothing on react-native-macos under the New Architecture). |
| `measureAnchor`, `useContainerWidth`, `useViewportWidth`, `useViewportHeight` | Layout measurement, which has no shared primitive. |
| `Select` | A choice from a list. The web keeps the browser's own select, with its look, keyboard and accessibility. iOS uses the system's menu (SwiftUI's Picker, from `@expo/ui`), and Android Material's dropdown menu (Compose's); on both, a selected choice cell is itself the menu, so its next tap chooses. macOS, which React Native gives no select, has a button that opens a menu of the options in the `Portal`. |
| `Checkbox` | The web keeps the browser's own checkbox, in a `label` when it has text. React Native has none, so native is a small square that fills with a tick, set in a row beside its text, since a `label` is a Text there. |
| `CellLink` | A link in a cell (an email, a phone number, a web address, an attachment, a related row). The web keeps the browser's link, and a button for a related row. macOS clicks it the same way and has the system open it, since React Strict DOM's `<a>` doesn't follow its `href` on native. A touch screen shows the value as text, so a tap selects the cell and a second edits it (or opens a relation's picker), with a button beside it that opens the link. |
| `Toggle` | On or off. The web and macOS keep their checkbox. On a phone a setting is the system's switch (SwiftUI's Toggle on iOS, Material's Switch on Android), its text before it, and a table cell is a symbol a tap flips (iOS's check circle, Material's check box), since the HIG keeps switches to list rows. |
| `Sheet` | Something edited apart from the view (a row's page). The web and macOS: a card over the page with its buttons along the foot. iOS: the system's page sheet (React Native's Modal, so nothing is hosted in SwiftUI), the leaving action leading and Save trailing, swiped away when nothing is lost and asking Discard Changes or Keep Editing when something would be. Android: Material's full-screen dialog. A view's settings (`size: "settings"`) are a form sheet on iOS that opens half way and grows, with a grabber and Done (react-native-screens' formSheet; React Native's Modal has no detents); elsewhere they stay a panel in the page. |
| `DateInput` | A date, time, or date and time picked in a selected cell. iOS: the system's compact date picker (SwiftUI's), opening the calendar or time wheels. Android: Material's date and time dialogs (Compose's). The web and macOS type dates in the cell's editor (the web's own date input), so there it's unavailable. Typing on a selected cell still opens its text editor everywhere, so a typed or pasted date still parses. |
| `systemColors` | The interface's colours. On iOS, each light/dark pair a view writes is swapped at load for the system colour that plays the same role (label, secondary label, separator, system background, system blue and red, link) through PlatformColor, so they follow dark mode and Increase Contrast. The web, macOS and Android keep the palette as written; choice pills are data colours and keep theirs. |
| `inputAttributes` | The keyboard a field wants (`inputHints`). The web keeps the browser's input types (a date picker, a number field). React Native has neither, and React Strict DOM turns `type="number"` into a digits-only pad, so native passes the input mode alone, and sets the keyboard with a minus and a point for a signed number on the TextInput itself. |
| `RowActions` | A row's actions (open its document, insert, delete). The web and macOS: right-click for a menu at the pointer. iOS: touch and hold for the system's context menu (UIKit's `UIContextMenuInteraction` on the row's own view, from react-native-ios-context-menu), lifting a card with the row's title; not @expo/ui's ContextMenu, which hosts the row inside SwiftUI, where hosted rows lost their text. Android: touch and hold for Material's dropdown menu (Compose's, from `@expo/ui`). |

The pattern is worth stating plainly: the forks are **scrolling,
dragging, measuring, overlays and the two form controls React Native
lacks**: the things no cross-platform
abstraction unifies, because they are where platforms genuinely differ.
Feature code does not fork. If a new fork appears outside
`internal/`, that is a signal worth examining rather than a routine
cost.

### Overriding a control

Where a fork is a control (`RowActions`, `Select`, `DateInput`, `Toggle` and `Sheet` so far), table-ui draws the
platform's own by default, and a host app can pass its own instead:

```tsx
import { PlatformControlsProvider } from "@workspace.sh/table-ui";
import type { RowActionsProps } from "@workspace.sh/table-ui/shared";

function MyRowMenu({ actions, children }: RowActionsProps) {
  // `children` is the row; `actions` are what can be done to it, each
  // with a label, an SF Symbol and Material Symbol name, `destructive`
  // for delete, and `onSelect`.
  return <MyMenu items={actions}>{children}</MyMenu>;
}

<PlatformControlsProvider value={{ RowActions: MyRowMenu }}>
  <TableView … />
</PlatformControlsProvider>
```

The value is partial: what's given replaces the default, and every
other control stays the platform's. The slots' props are types in
`@workspace.sh/table-ui/shared` (`controlSlots.ts`), free of any
renderer, so another view library (table-gtk) offers the same actions
in its own controls. A component's static `gesture` ("Right-click a
row", "Touch and hold a row") words the views' hints.

`@expo/ui` is an optional peer dependency: only the iOS and Android
defaults load it, and they need a development build (not Expo Go).

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
npm run core:test                 # node:test suite
npm run core:test:watch           # watch mode
npm run core:typecheck

# Web (full demo). Edits are kept in the browser that made them, never in
# the repo, until that browser's data is cleared or you press Reset demo
# data in the sidebar.
npm run web:dev                   # vite at http://localhost:5173
npm run web:build                 # production bundle (PAGES_BASE=/table-file-format/ for GitHub Pages)
npm run web:preview               # preview the built bundle
npm run web:typecheck
npm run test -w @workspace.sh/table-web   # the demo's own tests
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
  design; everything else is the consuming app's concern. A table that
  wants its own history in the format uses the optional
  `history.ndjson` (SPEC section 14, D44). See
  [docs/DECISIONS.md D14](docs/DECISIONS.md) for the full rationale and
  Workspace-specific guidance.

## Spike, not product

This is a research spike inside the
[Workspace](https://github.com/workspace-sh) product family — local-first
markdown for information workers. The format is intended to be
genuinely open and app-agnostic; the reference viewer doubles as a
[react-strict-dom](https://github.com/facebook/react-strict-dom)
playground for Workspace's UI direction. Names, internals, and APIs
will move until 1.0.
