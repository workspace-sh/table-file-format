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

### Writer atomicity

Writers MUST NOT expose partially-written files to readers. The
reference discipline (DECISIONS D24, mirrored from the
`index.sqlite` rule in section 8): **stage** every file's full
content to a `<name>.tmp` sibling first, then **commit** each via
`rename()` — atomic per file within a directory — and only then
**trim** stale files (body deletions last, so a crash can never
leave bodies deleted-but-not-rewritten). A failure before the commit
phase leaves the previous table byte-for-byte intact; stray `*.tmp`
files are inert because readers ignore unknown files (above) and
body readers match `*.md` only.

This is atomicity against concurrent readers and crashes, not
power-loss durability — writers MAY additionally fsync when their
platform demands it.

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

#### Enum entries — string or object

Each `enum` entry is **either** a bare string **or** an object
carrying display metadata:

```json
{
  "constraints": {
    "enum": [
      { "value": "planning", "color": "gray",   "label": "Planning" },
      { "value": "active",   "color": "green",  "label": "Active"   },
      "done"
    ]
  }
}
```

- `value` (required) — the stored data value. This is the only part
  that participates in validation and enum-ordered sort/group.
- `color` (optional) — symbolic, one of the 8-color Notion / Linear
  palette: `gray`, `red`, `orange`, `yellow`, `green`, `blue`,
  `purple`, `pink`. Consumers map the symbolic name onto their own
  light/dark theme; the format never stores hex.
- `label` (optional) — display-only text; defaults to `value`.

Bare strings and objects may be mixed in one array. Readers MUST
coerce a bare string `"x"` into `{ "value": "x" }` (reference:
`enumOptions()` in `@workspace.sh/table-core`). Writers MAY emit
either form — objects when color/label is set, strings otherwise.

### Field annotations

- `format: "<token>"` — display-semantic hint from a closed
  vocabulary (see "Field format" below). Renderer hint; no validator
  effect. Stored values stay raw.
- `icon: "<emoji-or-name>"` — an emoji (`"💰"`) or symbolic name
  (`"calendar"`) shown beside the field title. Display-only;
  consumers MAY ignore.
- `description: "<text>"` — hover-help / accessibility text.
  Display-only, round-trips.
- `attachment: true` — the value is a filename inside `attachments/`.
- `relation: { table: "<name>", field: "id", cardinality?: "one" | "many" }`
  — the value points at a row (or, for `"many"`, an array of rows) in
  a sibling `.table/` directory by that table's system `id`.
  `cardinality` defaults to `"one"`; `"many"` means the row value is
  an array of ids. Resolution is the app's concern (scan workspace,
  walk parent, etc.).
- `deprecated: true` — the field is kept for backwards compatibility
  but should not be shown in new UIs.
- `computed: { … }` — RESERVED; see "Computed fields (reserved)".

### Field format

`format` declares a display *semantic* from a closed vocabulary — a
portable enum, not an arbitrary printf string. Stored values remain
raw (ISO dates, decimal numbers, plain text); locale-aware rendering
is the consumer's job (`Intl.NumberFormat` / `Intl.DateTimeFormat`).
Reference renderer: `formatValue()` in `@workspace.sh/table-core`.
Unknown tokens fall back to plain text.

**Number** (`number`, `integer`, `year`): `integer`, `decimal:N`
(N fraction digits), `percent`, `currency:<ISO-4217>` (e.g.
`currency:USD`), `duration:seconds`.

**Date** (`date`, `datetime`): `iso` (default), `short`, `long`,
`weekday`, `relative`.

**String** (`string`): `plain` (default), `markdown` (already
honoured by the body editor), `url`, `email`, `phone`. The last three
are link-rendering hints; the stored value is the raw target.

### Computed fields (reserved)

RESERVED — not yet implemented. A field MAY carry a `computed`
declaration for a formula whose result is derived, never stored:

```json
{
  "name": "total",
  "type": "number",
  "computed": { "expr": "price * quantity", "dialect": "table-expr-v1" }
}
```

The expression lives in the schema (one definition for every row);
the result is **never persisted** — recomputed on read, so there is
no "stored 100 but recomputes to 110" staleness class. The optional
`index.sqlite` cache MAY materialise results for query speed.

Until an evaluator ships, readers MUST tolerate a `computed` field's
presence — it simply renders empty. The expression dialect, the
standard library, and whether cross-row aggregation is ever in scope
are open; the shape here is provisional (see DECISIONS D21). Do not
write tooling against it yet.

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

Every row MUST have an `id` field at the top level. The `id` is
**system-level**: it is minted by the writer, never edited by the
user, and never declared in `schema.json` (it is implicit on every
row).

**Validity** is deliberately loose: any non-empty string, unique
within the table. Hand-authored ids (`p1`, `budget-2026`) are legal —
a `.table/` edited by a human or an agent outside a managed workspace
should not need opaque identifiers.

**Writer-minted ids** SHOULD be 25 characters from the lowercase
base36 alphabet `0-9a-z` (~129 bits; reference: `newId()` in
`@workspace.sh/table-core`). The alphabet is deliberately
**case-safe**: ids are used verbatim as filenames (`bodies/{id}.md`),
and on case-insensitive filesystems (default APFS, NTFS) two ids
differing only in letter case would resolve to the same path and
silently overwrite each other. For the same reason, all ids — minted
or hand-authored — MUST be filename-safe and SHOULD avoid case-only
distinctions from other ids in the table. (DECISIONS D23.)

`id` is what cross-table `relation` references resolve against.
`primaryKey` (if present) is a separate domain-level uniqueness
constraint over user-facing fields, not row identity.

### Row ordering

Row order in `rows.ndjson` is **not** semantically meaningful. Display
order belongs in views (`sort` and `group`). Append-friendly:
appending a new row to the end MUST be a valid edit, even
mid-document.

### Canonical write order

Readers MUST NOT assign meaning to row order, but writers SHOULD
produce a **canonical serialisation**: rows in stable insertion order
(new rows appended, existing rows keep their line position), and
within each row, keys in schema declaration order with `id` first.

Why this matters: two independent writers materialising the same
logical state should produce **byte-identical** files. Without a
canonical form, equal states produce unequal bytes — git sees phantom
diffs, content-addressed storage can't deduplicate, and a sync engine
can't answer "have these replicas converged?" with a hash comparison.
Deterministic output is what lets git and log-based replication (see
docs/STORAGE-AND-SYNC.md) compose instead of compete.

This is a SHOULD, not a MUST: a hand-edited `.table/` with shuffled
keys is still valid. Canonical order is a property of well-behaved
writers, not a validity rule.

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

`table`, `board`, `gallery`, `list`, `calendar`. The `layout` field is a
fixed enum — apps render based on this value.

The `name` field is **free-form** and user-facing — it's what shows up
in view switchers and lists. Apps must not parse it; it can be in any
language and contain any Unicode text. The pair `(layout, name)` lets
the same layout type appear multiple times with different names (e.g.
two `"table"` views named "Active" and "Done").

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

- `board_field` — column field for board layouts.
- `gallery_field` — hero/lead field for gallery cards.
- `calendar_field` — date field for calendar layouts.
- `calendar_range` — optional `{start, end}` (YYYY-MM-DD) bound for
  `layout: "calendar"` views. When present, calendar navigation is
  locked to this window: prev / next disable at the bounds and the
  initial cursor snaps inside the range. Useful for project calendars
  (locked to project duration), sprint cycles, event-specific
  calendars. Apps that don't recognise the field should still render
  the calendar correctly — they'll just allow free navigation.

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

`modified_at` SHOULD be stamped only on **user-initiated** writes —
not on mechanical re-materialisations (sync engines applying remote
ops, cache rebuilds, format migrations). A sync engine that touches
`modified_at` on every apply turns the field into a permanent
conflict generator: every replica's materialisation differs by
timestamp alone, defeating the canonical-write-order guarantee (section 3).

## 6. `attachments/`

Files referenced by row values whose field declares
`attachment: true`. The row stores the **filename only** (e.g.
`"avatar": "headshot.png"`); resolution against `attachments/` is the
**consuming app's concern** (like relation resolution — see section 2).
The reference core deliberately does not load attachment contents:
`parseTable` reads `bodies/` into memory (small, text, per-row) but
only ever treats `attachments/` as an opaque directory (arbitrary
size, binary). The asymmetry is intentional.

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

The interface (`buildIndex`, `queryIndex`, `isIndexStale`,
`dropIndex`) lives in `@workspace.sh/table-core` as types; concrete
implementations belong in optional per-platform packages (Node via
`node:sqlite`, RN via op-sqlite / expo-sqlite, browser via
wa-sqlite + OPFS — or no cache at all; the in-memory query path is
always sufficient). The implementation is currently a stub.

### Query interface — structured, not raw SQL

`queryIndex` accepts the **view query AST** — the same
`filter` / `sort` structures defined for `views.json` (section 4) plus an
optional free-text `search` string — and compiles to SQL internally.

Consumers MUST NOT be handed raw SQL access. Rationale:

- The cache's internal layout (column naming, encodings, FTS
  configuration) is an implementation detail; raw SQL would freeze it
  into a public contract.
- The indexed path and the in-memory fallback (`applyFilters` /
  `applySort` / `searchRows`) share one query language by
  construction, so results cannot diverge by accident.
- User-supplied search text never reaches an SQL string.

### Staleness contract

The index stores `{schema_hash, rows_hash, format_version, built_at}`
in a `_meta` table inside the database. `isIndexStale` re-hashes
`schema.json` + `rows.ndjson` and compares.

Hashing — not mtime comparison — because git does not preserve
mtimes: checkouts and pulls rewrite them even when content is
unchanged, which makes an mtime-based check rebuild after every git
operation. Content hashing is correct across git, file copies, and
clock skew, and costs ~50ms on a multi-MB NDJSON.

### Rebuild contract

Rebuilds are **whole-file**: parse `rows.ndjson`, insert in a single
transaction. At this format's realistic size class (tens of
thousands of rows — Airtable caps at 50k/base) a full rebuild is
sub-second; incremental indexing is deliberately out of scope until
a real consumer outgrows that. (The format is already
incremental-friendly if needed: append-only edits can be detected by
prefix hash + byte watermark.)

Writers MUST build into a temporary file and atomically rename over
`index.sqlite`, so a concurrent reader never observes a half-built
index. WAL mode is recommended. Deleting `index.sqlite` at any
moment MUST be safe (it is, by the fallback rule).

### Full-text search includes bodies

The cache indexes an FTS5 virtual table over all string-typed fields
**and** the contents of `bodies/{id}.md`, keyed by row id. The
in-memory `searchRows` already searches bodies; an index that omitted
them would silently return fewer hits than the fallback — the worst
kind of divergence, invisible until a missing result is noticed.

### Field-type → SQLite storage class mapping

The cache materialises rows into a SQLite table typed per-column.
Mapping:

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

## 10. Addressing

Stable addressing for rows, views, and tables — used by:

- Cross-table relations (per-field `relation` references one row in
  another `.table/`)
- Cross-format references (a markdown body inside `bodies/{id}.md`
  linking to a row elsewhere, an external markdown file linking into
  a `.table/`, etc.)
- Application-level deep links (URL hashes, share links)

### Address grammar

An address is a path to a `.table/` followed by an optional URL
fragment:

```
<path>[#<key>=<value>[&<key>=<value>]*]
```

- `<path>` — a file-system path to a `.table/` directory. Relative
  or absolute, app-resolved. Format files SHOULD use relative paths
  (typically against the containing workspace root) so the address
  survives directory moves.
- `<key>=<value>` — a key-value pair. Keys defined by this spec:
  - `row=<id>` — the row with this system `id`
  - `view=<id>` — the view with this id
  - `field=<name>` — a specific field on the row (cell-level
    addressing for future affordances; reserved)

Multiple pairs join with `&` (the same convention as URL query
strings). Order is not significant. Unknown keys MUST be tolerated
by readers — apps MAY define additional keys (e.g. `query=`,
`highlight=`) but consumers that don't recognise them should
silently ignore.

### Examples

```
docs/projects.table                              # whole table
docs/projects.table#row=p1                       # specific row
docs/projects.table#view=v3                      # specific view
docs/projects.table#row=p1&view=v3               # row pinned to view
../suppliers.table#row=ACME_CORP                 # cross-directory
```

### Resolution

Resolution is the app's concern. The format does not prescribe how a
path resolves to a `.table/` directory — apps choose (filesystem
scan, in-memory map, fetch over HTTP, etc.). Reference helpers in
`@workspace.sh/table-core` (`parseAddress`, `formatAddress`,
`resolveRow`) implement the grammar but accept a caller-supplied
lookup function.

`row=` MUST resolve against the system `id` field. If a target row's
`id` is not found, the address is **dangling** — apps SHOULD surface
this visibly rather than silently rendering nothing.

### Relation interop

Per-field `relation` (section 2) references a row by `id` but does NOT use
the address grammar literally — relations are structured as
`{table, field}` on the field declaration plus the bare `id` value
on the row, so apps can resolve them efficiently without parsing a
string. Conceptually, a relation `{table: "tasks", field: "id"}` with
row value `"t_42"` corresponds to the address
`<path-to-tasks.table>#row=t_42` — the grammar is the
serialisation; the relation declaration is the structured form.

### Reverse direction (markdown → row)

A markdown body inside `bodies/{id}.md` MAY contain links that use
the address grammar:

```markdown
See [the active sprint](../sprints.table#row=sp_current) for the
plan.
```

How those links are rendered, opened, or scrolled is the consuming
app's concern. The format only standardises the grammar.

## 11. Interop

`.table/` belongs to an open coalition of text-first data interchange
formats (CSVW, Frictionless Data, Obsidian Bases, etc.) — none gets
top billing.

CSV is the **only** format-specific converter that lives in core, via
`fromCSV` / `toCSV` in `@workspace.sh/table-core`:

- `fromCSV(csv, schema?)` — parses RFC 4180 (quoted fields, embedded
  commas / newlines / escaped `""`, optional BOM, LF or CRLF). With a
  schema, cells are coerced to declared types (the lossless-with-schema
  path); without one, per-column types are inferred. Rows lacking an
  `id` column get a freshly minted nanoid.
- `toCSV(table, { fields? })` — RFC 4180-correct quoting. **Lossy by
  definition**: relations serialise to raw id(s), attachments to their
  filename, bodies aren't represented. `csvExportWarnings(table)`
  returns the human-readable list of what a given export will drop, so
  the loss is surfaced rather than silent.

Other format converters (Frictionless, CSVW, Grist, Obsidian Bases)
belong in separate optional packages (`@workspace.sh/table-frictionless`,
`@workspace.sh/table-csvw`, etc.) if and when there's demand.

## 12. Versioning

The spec covers two version axes only — the spec itself, and the
schema. Data versioning (edit history, undo, audit, real-time
collaboration) is **explicitly the consuming app's concern** (see
docs/DECISIONS.md D14).

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

**Single-writer scope.** `schema-version` is a monotonic counter and
is meaningful only in the absence of concurrent writers (one device,
or git with human-resolved merges). Under multi-writer sync, two
offline peers can both bump 1 → 2 with *different* schemas — so there
the counter is **advisory only**, and the sync layer's linearisation
order (see docs/STORAGE-AND-SYNC.md) is authoritative for which schema
state supersedes which. Consumers MUST NOT use `schema-version`
equality as proof of schema equality across replicas; compare the
field set itself. (DECISIONS D22.)

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
