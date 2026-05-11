# `.table/` format specification

> Spike-status. Versioned by `formatVersion: 1` in `meta.json`. Will
> move before 1.0.

A `.table/` is a directory that IS a file. The extension is `.table`.
The directory contains plain-text files designed for line-diffable
storage in git, plus an optional rebuildable SQLite cache.

## 1. Directory layout

```
my-data.table/
├── schema.json          REQUIRED
├── rows.ndjson          REQUIRED
├── views.json           OPTIONAL
├── meta.json            OPTIONAL — implicit empty if missing
├── attachments/         OPTIONAL
├── bodies/              OPTIONAL
│   └── {row.id}.md
└── index.sqlite         OPTIONAL — gitignored rebuildable cache
```

Readers MUST tolerate any of the optional members being absent. Readers
MUST ignore unknown files at the directory root. Writers SHOULD
preserve unknown files on round-trip (treat them as the user's domain).

## 2. `schema.json`

Defines the fields of every row, their types, and any constraints.

```json
{
  "fields": [
    {
      "name": "title",
      "type": "string",
      "constraints": { "required": true }
    },
    {
      "name": "status",
      "type": "string",
      "constraints": { "enum": ["planning", "active", "done"] }
    },
    {
      "name": "summary",
      "type": "string",
      "format": "markdown"
    }
  ],
  "primaryKey": ["title"],
  "schema-version": 1
}
```

### Field types

`string`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`,
`year`, `array`, `object`, `duration`, `geopoint`, `geojson`.

Field type names follow standard conventions used across text-first
data formats. `.table/` is not aligned with any specific format —
borrowing the names is for readability, not compatibility.

### Field constraints

`required`, `unique`, `enum`, `minimum`, `maximum`, `minLength`,
`maxLength`, `pattern`.

### Field annotations

- `format: "markdown"` — the value is markdown content. Renderer hint;
  no validator effect.
- `attachment: true` — the value is a filename inside `attachments/`.
- `relation: { table: "<name>", field: "id" }` — the value points at a
  row in a sibling `.table/` directory by that table's system `id`.
  Resolution is the app's concern (scan workspace, walk parent, etc.).
- `deprecated: true` — the field is kept for backwards compatibility
  but should not be shown in new UIs.

### Schema evolution

Schema evolution is **append-only**. Never remove or rename a field.
Add new fields; mark old ones `deprecated: true` to retire them.
Reordering enum values changes sort/group semantics and SHOULD bump
`schema-version`.

### Manifest declaration

Schema files MAY include third-party extension keys with the `x-`
prefix. Readers MUST ignore unknown keys; writers MUST preserve them
on round-trip.

## 3. `rows.ndjson`

One JSON object per line. Each row is independently parseable. Blank
lines are skipped. The file ends with a trailing `\n` (POSIX-correct).

```ndjson
{"id":"p1","title":"Workspace v1","status":"active","priority":1}
{"id":"p2","title":"Table file format spike","status":"done","priority":2}
```

### System `id`

Every row MUST have an `id` field at the top level — a stable nanoid,
21 chars, URL-safe alphabet. The `id` is **system-level**: it is
minted by the writer, never edited by the user, and never declared in
`schema.json` (it is implicit on every row).

`id` is what cross-table `relation` references resolve against.
`primaryKey` (if present) is a separate domain-level uniqueness
constraint over user-facing fields, not row identity.

### Row ordering

Row order in `rows.ndjson` is **not** semantically meaningful. Display
order belongs in views (`sort` and `group`). Append-friendly:
appending a new row to the end MUST be a valid edit, even
mid-document.

## 4. `views.json`

A list of saved views. Views are **shared/team views only** — personal
view state (last opened, scroll position, etc.) lives in app-local
storage outside the `.table/` directory.

```json
[
  {
    "id": "v1",
    "name": "Active by priority",
    "layout": "table",
    "fields": ["title", "status", "priority"],
    "filter": [{ "field": "status", "operator": "neq", "value": "done" }],
    "sort": [{ "field": "priority", "direction": "asc" }]
  }
]
```

### Layouts

`table`, `kanban`, `gallery`, `list`, `calendar`.

### Filter operators

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`,
`starts_with`, `ends_with`, `empty`, `not_empty`, `in`, `not_in`.

### Sort behaviour

- For enum fields, sort by the enum's **declared order** (not
  alphabetical).
- Null/undefined values sort **last regardless of direction**
  (asc and desc).

### Group behaviour

- Returns rows bucketed by the group field value.
- Keys are ordered by the field's enum declaration when an enum
  constraint is present; otherwise by row arrival.
- Rows with null/undefined/empty group value go into the literal
  `"(empty)"` bucket, which always sorts last.

### Layout-specific fields

- `kanban_field` — column field for kanban layouts.
- `gallery_field` — hero/lead field for gallery cards.
- `calendar_field` — date field for calendar layouts.

## 5. `meta.json`

The manifest. Identifies the file as a `.table/` and carries
descriptive metadata.

```json
{
  "format": "table",
  "formatVersion": 1,
  "title": "Projects",
  "description": "Workspace product roadmap",
  "created_at": "2026-04-01T00:00:00Z",
  "modified_at": "2026-04-27T00:00:00Z",
  "generator": "table-file-format spike fixture"
}
```

`format` and `formatVersion` are stamped on every write. Readers MAY
use them to validate that a directory is a `.table/`.

## 6. `attachments/`

Files referenced by row values whose field declares
`attachment: true`. The row stores the **filename only** (e.g.
`"avatar": "headshot.png"`); the reader resolves under
`attachments/`.

To avoid filename collisions across rows, the recommended write
convention is `{nanoid}-{original-name}.ext`, but the format does
not enforce a specific naming scheme — readers MUST resolve the
filename verbatim against `attachments/`.

Orphan-attachment cleanup is an app concern. The format does not
specify size limits.

## 7. `bodies/`

Optional long-form markdown bodies, one file per row. Filename is the
row's stable system `id` plus `.md`:

```
bodies/
├── p1.md
└── p2.md
```

Each body is a standalone, readable markdown file. Bodies are intended
for the **canonical long-form content** of a row — the Notion
*every-row-is-also-a-page* pattern.

For shorter inline markdown content (a description, a one-paragraph
summary), use a string field with `format: "markdown"` instead.

Rules:
- A body file MUST have a corresponding row in `rows.ndjson`. Orphan
  body files (file present, no row) are a validator warning.
- A row WITHOUT a body file is valid; bodies are optional per row.
- Writers wholesale-replace `bodies/` on `writeTable`: bodies not
  present in the input are removed from disk. Partial-update APIs
  belong elsewhere (`writeBody(dir, id, content)` is intended but not
  yet implemented).

## 8. `index.sqlite`

OPTIONAL rebuildable cache for filtered queries and full-text search.
Never the source of truth.

- Excluded from git via `.gitignore`.
- When present and fresh, readers SHOULD use it for fast queries.
- When absent or stale, readers MUST fall back to scanning
  `rows.ndjson`.
- Apps decide their own caching strategy; the format prescribes only
  the fallback rule.

The interface (`buildIndex`, `queryIndex`, `isIndexStale`, `dropIndex`)
is locked; the implementation is currently a stub.

### Field-type → SQLite storage class mapping

When implemented, the cache will materialise rows into a SQLite table
typed per-column. Mapping:

| Field type | SQLite class | Notes |
| --- | --- | --- |
| `string` / `date` / `datetime` / `time` / `geojson` | TEXT | dates as ISO-8601 |
| `number` | REAL | |
| `integer` / `year` | INTEGER | |
| `boolean` | INTEGER | 0/1 |
| `array` / `object` | TEXT | JSON-encoded |
| `geopoint` | TEXT or two REAL columns | `"lat,lon"` or split |
| (any when missing) | NULL | |

## 9. Validation

A `.table/` is **valid** when:

1. Every row has a non-empty system `id`, and ids are unique.
2. Every row's field values match the declared types and constraints.
3. If `primaryKey` is declared, no two rows share the same composite
   key.
4. Every body file in `bodies/` has a matching row.

Validators MAY surface warnings for: orphaned attachments, dangling
relations (cross-table reference to a missing id), unused enum values.
None of these block validity.

## 10. Interop

`.table/` belongs to an open coalition of text-first data interchange
formats (CSVW, Frictionless Data, Obsidian Bases, etc.) — none gets
top billing. Direct converters in core: CSV (lossy export, lossless
import with schema). Format-specific exporters belong in separate
optional packages (`@workspace/table-frictionless`,
`@workspace/table-csvw`, etc.) if and when there's demand.

## 11. Versioning

The spec covers two version axes only — the spec itself, and the
schema. Data versioning (edit history, undo, audit, real-time
collaboration) is **explicitly the consuming app's concern** (see
docs/DECISIONS.md §D14).

### Spec version — `formatVersion`

The spec itself is versioned by `formatVersion` in `meta.json`. The
current value is `1`. Breaking changes bump the major; additive
changes do not. Readers SHOULD warn on `formatVersion` higher than
they recognise but MAY still attempt to read.

### Schema version — `schema-version`

The schema is independently versioned via the `schema-version` field
on `schema.json`, which the app increments when it changes the schema
in ways the app considers significant (typically: reordering enums,
changing constraints).

### Data versioning (NOT in the format)

The format does **not** specify a per-row history, edit log,
concurrency semantics, or conflict-resolution model. Every NDJSON-row
design choice (line-diffability, per-row bodies in separate files,
append-friendly ordering) exists so **git is the version-control
substrate** — any consumer that uses git gets full history, diffing,
merging, branching, and authorship for free.

Apps that need versioning beyond what git provides (in-app undo,
"what did this row look like yesterday," audit trail, real-time
collaboration) implement it themselves. A future optional
`history.ndjson` extension is reserved at the directory root for a
portable append-only edit log, but it is **not yet specified** — its
shape will be designed when a consumer's UX actually motivates it.
