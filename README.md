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
├── views.json           optional — saved views (table/kanban/gallery/list/calendar)
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
import { parseTable, applyView, validate } from "@workspace/table-core";

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

## Repo layout

```
.
├── src/
│   ├── core/        format library (parser, writer, validator, query, indexer stubs)
│   └── demo/        Vite + react-strict-dom + StyleX viewer
├── fixtures/
│   ├── projects.table/   7 rows, 7 views, one body
│   └── tasks.table/      8 rows, cross-table relation to projects
└── docs/
    ├── SPEC.md      format specification
    ├── ARCHITECTURE.md   code organisation, build pipeline, design choices
    └── DECISIONS.md      log of non-obvious design decisions and their reasoning
```

## Running

```sh
npm install
npm run dev          # starts the demo viewer at http://localhost:5173
npm test             # node:test suite (33 tests, format library only)
npx tsc --noEmit     # typecheck without emit
```

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
- Inline cell editing in the demo viewer
- Cross-table relation drilldown
- Markdown ↔ `.table/` cross-reference addressing
- CSV converter (`fromCSV` / `toCSV`)

## Spike, not product

This is a research spike inside the
[Workspace](https://github.com/workspace-sh) product family — local-first
markdown for information workers. The format is intended to be
genuinely open and app-agnostic; the reference viewer doubles as a
[react-strict-dom](https://github.com/facebook/react-strict-dom)
playground for Workspace's UI direction. Names, internals, and APIs
will move until 1.0.
