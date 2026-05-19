# Architecture

## Repo layout

```
.
├── src/
│   ├── core/        format library — pure TS, Node-only IO
│   │   ├── types.ts
│   │   ├── id.ts
│   │   ├── parser.ts        readTable
│   │   ├── writer.ts        writeTable (wholesale-replace)
│   │   ├── validator.ts     validate, validateBodies
│   │   ├── query.ts         applyFilters, applySort, applyGroup, applyView
│   │   ├── indexer.ts       SQLite cache stubs
│   │   ├── index.ts         barrel — browser-safe re-exports
│   │   └── *.test.ts        node:test
│   └── demo/        Vite + RSD + StyleX viewer (web only)
│       ├── App.tsx
│       ├── Sidebar.tsx
│       ├── views.tsx        TableView / BoardView / GalleryView / ListView / CalendarView
│       ├── loadFixture.ts   pulls fixtures/projects.table/ via Vite imports
│       ├── main.tsx
│       ├── strict.css
│       └── vite-env.d.ts
├── fixtures/
│   ├── projects.table/   7 rows, 7 views, one body
│   └── tasks.table/      8 rows, cross-table relation to projects
├── docs/
│   ├── SPEC.md
│   ├── ARCHITECTURE.md   (this file)
│   └── DECISIONS.md
├── babel.config.js       react-strict-dom/babel-preset
├── postcss.config.js     react-strict-dom/postcss-plugin (StyleX extraction)
├── vite.config.ts
└── tsconfig.json
```

## Core library — design rules

### Browser-safe barrel, Node-only IO

`src/core/index.ts` re-exports everything that runs in any environment:
types, `id`, `validate`, `validateBodies`, `applyFilters`, `applySort`,
`applyGroup`, `applyView`, and the `indexer` stubs.

`parser.ts` and `writer.ts` are **deliberately omitted from the
barrel**. They import `node:fs` and would break in the browser. Node
consumers import them directly:

```ts
import { parseTable } from "@workspace/table-core/parser.js";
import { writeTable } from "@workspace/table-core/writer.js";
```

The demo never imports them — it loads fixtures via Vite static
imports instead (see `loadFixture.ts`).

### TypeScript module mode

`tsconfig.json` uses `module: "NodeNext"` + `moduleResolution:
"NodeNext"`, which requires explicit `.js` suffixes on relative
imports. `tsx` (the test runner) and Vite both handle `.js` → `.ts`
mapping at runtime.

### Test runner

`node:test` + `node:assert/strict`, run via `tsx`:

```sh
node --import tsx --test src/**/*.test.ts
```

No Jest, no Vitest. Tests live alongside source as `*.test.ts`.

## Demo — design rules

### Expo-portable, web-only-runtime

Every demo component is written for `react-strict-dom`'s strict subset
of `html.*` elements (`html.div`, `html.span`, etc.) and styled with
`css.create()` from `react-strict-dom`. The intent is for the demo
components to lift cleanly into an Expo 55 app on the Workspace side
when web rolls out as a target.

This means:
- **No `html.table`** — it doesn't exist on RN, so RSD doesn't ship
  it. Tables are rendered as nested flex divs.
- **No `display: "grid"`** — RN doesn't have CSS Grid. Flex only.
- **No raw `@stylexjs/stylex`** — always go through `css.create` from
  `react-strict-dom` so the styles compile to native primitives.
- **Explicit `display: "flex"`** on every flex container. RSD on web
  does not auto-set it (only on native does the equivalent kick in).

### Build pipeline

The demo follows the canonical `react-strict-dom` Vite setup, mirroring
[`facebook/react-strict-dom/apps/vite-app`](https://github.com/facebook/react-strict-dom/tree/main/apps/vite-app):

1. `@vitejs/plugin-react` configured with `babel: { configFile: true }`
   reads `babel.config.js` for the user code.
2. `vite-plugin-babel` applies the same babel config to `node_modules`
   files (so RSD's own `stylex.create()` calls get compiled).
3. `babel.config.js` uses `react-strict-dom/babel-preset`, which
   internally configures `@stylexjs/babel-plugin` with
   `importSources: [{ from: "react-strict-dom", as: "css" }]` so
   `css.create()` calls are recognised as StyleX entry points.
4. `postcss.config.js` invokes `react-strict-dom/postcss-plugin`,
   which scans source files (re-runs babel internally) and writes the
   collected CSS rules.
5. `src/demo/strict.css` contains the `@react-strict-dom;` directive
   that PostCSS replaces with the generated CSS.

### Fixture loading

The browser can't run `parser.ts` (it imports `node:fs`). The demo
loads `fixtures/projects.table/` via Vite static imports:

- `schema.json`, `views.json`, `meta.json` — JSON imports.
- `rows.ndjson` — `?raw` import, parsed line-by-line in
  `loadFixture.ts`.
- `bodies/*.md` — `import.meta.glob` with `{ eager: true, query:
  "?raw", import: "default" }`, then keyed by filename-without-`.md`.

If we later need browser-side parsing of arbitrary `.table/`
directories (e.g., File System Access API), that's the place to add a
small browser-safe parser.

## Build outputs

- `dist/` — TypeScript compilation of `src/core/` for the published
  library (`tsc`). The package's `main` and `types` point inside this.
- `dist-web/` — Vite production build of the demo (`vite build`).
- Both are gitignored.

## Workflow

- Default branch: `develop`. Never push directly.
- Topic branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`,
  `chore/<slug>`. Land via PR into `develop`.
- Open spec questions and design decisions get filed as GitHub issues
  for visibility.
