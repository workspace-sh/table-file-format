# Decisions

A log of non-obvious design choices for `.table/` and the reasoning
behind them. Every entry is a settled call; pivots get a new entry, not
edits to an old one.

## D1: System `id` is separate from `primaryKey`

Every row has an `id` (nanoid) that is system-level — minted by the
writer, never edited by the user. `primaryKey` (if present) is a
separate domain-level uniqueness constraint over user-facing fields.

**Why:** cross-table relations need a stable target that doesn't break
when users rename their domain key. `id` provides that; `primaryKey`
is purely about user-facing uniqueness validation.

## D2: NDJSON ends with a trailing newline

`rows.ndjson` ends with `\n` (POSIX-correct).

**Why:** makes `wc -l` accurate, ensures the last line is well-formed
on append, plays nicely with line-oriented Unix tools.

## D3: Cross-table relations reference table by **name**, not path

```json
"relation": { "table": "projects", "field": "id" }
```

**Why:** path-based references break when the workspace is reshuffled
(folder rename, restructure). Name-based resolution is the app's
problem (scan workspace, walk parent dir) but the format itself stays
self-contained and rename-resilient.

## D4: `views.json` is for shared views only

Personal/per-user view state (last opened, scroll position, focused
row) lives in app-local storage **outside** the `.table/` directory.

**Why:** `.table/` is meant to round-trip cleanly through git and
between users. Personal state would create noisy diffs and would be
meaningless to other users. A future `views/` directory convention
could be added non-breakingly if needed.

## D5: Enum sort/group order follows declaration

When a field has an enum constraint, its values sort and group by the
enum's **declared order**, not alphabetical order.

**Why:** enums encode semantic order (`todo` → `doing` → `done`).
Alphabetical defeats the purpose. Reordering enum values is therefore
a behaviour change and SHOULD bump `schema-version`.

## D6: SQLite cache is optional and rebuildable

`index.sqlite` is a performance layer only. Readers fall back to
scanning `rows.ndjson` when the cache is absent or stale.
Apps decide their own caching strategy.

**Why:** keeps the format self-contained as plain text; lets apps
opt into the performance tier they need. Removes the spec burden of
prescribing cache freshness rules beyond the fallback contract.

## D7: Attachments — row stores filename only

Field declared `attachment: true`; row holds the bare filename;
reader resolves under `attachments/`. Recommended write convention to
avoid collisions: `{nanoid}-{original-name}.ext`.

**Why:** the filename in the row is human-readable and grep-friendly.
Path resolution is centralised in one place (`attachments/`) so
moves/renames of the table don't cascade through every row.

## D8: Format extension is `.table`

Final.

**Why:** `.table` is unclaimed in practice (SQL keywords and HTML
elements aren't file extensions), reads correctly in conversation
(*"send me your suppliers.table"*), and follows the same naming
pattern as Airtable / Google Tables / Notion — category-format named
after the most recognisable presentation, even when the format
supports many other layouts (board, gallery, list, calendar).

## D9: Frictionless framing dropped

The format is **not** a "Frictionless Table Schema superset." It owns
its own schema vocabulary. Field type names (`string`, `integer`,
`enum`, etc.) follow conventions used across text-first data formats
generally — they're the right names for these things, not a
compatibility claim with any specific format.

**Why:** the original spec claimed Frictionless alignment, but
`.table/`'s extensions (per-field relations, views, attachments,
schema versioning, deprecation) carry the format's actual value;
Frictionless contributes only field-type names. Calling it a "superset"
was dressing on a different format. Frictionless tooling lives in
data-publishing communities; the target user (information worker) has
not heard of it. The interop benefit didn't accrue to the actual user.

Frictionless / CSVW / Obsidian Bases conversion now belongs in
*optional* downstream packages, not the core spec.

## D10: Per-field `relation` is the only relation primitive

`foreignKeys` (the Frictionless-style table-level constraint) is **not**
carried. Cross-table links are field-typed via the `relation`
annotation.

**Why:** Airtable-style relations are field-typed, not table-level. The
original spec carried both *"for interop"*, but the duplication was
sunk cost — nobody was cashing in on the Frictionless side, and
maintaining two relation primitives for the same concept added
mental load.

## D11: Manifest fields in `meta.json`

Every write stamps `format: "table"` and `formatVersion: 1` onto
`meta.json`. Readers MAY use them to validate that a directory is a
`.table/`.

**Why:** a directory called `projects.table/` should self-identify.
Without a manifest field, a reader has only the extension as a signal,
which is filesystem-level and unreliable for tooling that operates on
pipes/streams.

## D12: Long-form bodies live in `bodies/{id}.md`

Optional. Each body is a standalone markdown file named by the row's
stable system `id`. The Notion *every-row-is-also-a-page* pattern,
made line-diffable.

For shorter inline markdown content (a description, a one-paragraph
summary), use a string field with `format: "markdown"` instead.

**Why:** NDJSON's *one-line-per-row* promise breaks down for long-form
content — a 500-line markdown body becomes a giant single line in
`rows.ndjson` with `\n`-escaped newlines, and `git diff` shows the
whole row as changed when a single paragraph edits. Splitting bodies
into per-row files preserves line-diffable history for prose while
keeping `rows.ndjson` tight and scannable. Each body is also
independently readable as a standalone `.md` file (`cat bodies/p1.md`
returns clean markdown).

## D13: Spike workflow

Default branch is **`develop`**. Work lands via PR from feature
branches. Open spec questions get filed as GitHub issues so they're
discoverable.

**Why:** PR-driven workflow gives the spike a clean review surface
and makes the rationale for each change auditable in the commit log.
Topic-branch naming follows the standard `feat/<slug>` / `fix/<slug>`
/ `docs/<slug>` / `chore/<slug>` convention.

## D14: Data versioning is the consuming app's concern (parked)

The format does **not** specify a data-versioning model — no per-row
history, no edit log, no concurrency/conflict semantics, no audit
trail format. The spec covers two distinct version axes only:

- **`formatVersion`** in `meta.json` — versions the spec itself
  (currently `1`).
- **`schema-version`** in `schema.json` — versions the user's data
  schema (bumps on structural change: field added/deprecated, enum
  reordered, constraints tightened).

Everything else — undo/redo, "what did this cell look like
yesterday," real-time collaboration, audit logs — is left to the
consuming app.

**Why:** every NDJSON-row design choice in `.table/` (line-diffable
rows, per-row bodies in separate files, attachments by filename,
append-friendly ordering) exists so **git is the version-control
substrate**. For any consumer that uses git, the format gets full
history, branching, merging, diffing, and authorship for free.
Specifying a parallel in-format versioning system would reinvent what
git already does well and would bias the format toward one app's UX
needs over others.

Where each app-level need belongs:

| Need | Owner | How |
|---|---|---|
| Undo/redo within an editing session | App | In-memory stack of inverse edits |
| Async collaboration (two users, different times) | Git | Line-diffable rows merge cleanly |
| Real-time collaboration (two users, same moment) | App | CRDTs / OT — separate research area |
| "What did this row look like yesterday?" | App or git | `git log` / `git blame` for git-backed; app-side log otherwise |
| Audit / compliance trail | App | Append-only event log; see reserved extension below |
| Schema migration tracking | Format | `schema-version` bumps on structural change |

### Reserved extension: `history.ndjson`

Not yet specified, not yet implemented. Reserved for if/when a
consuming app needs a portable, in-format edit log. Likely shape when
it lands: an optional `history.ndjson` at the directory root, one
event per line:

```json
{"id":"e_xyz","at":"2026-04-28T15:00:00Z","by":"leslie","op":"set","row":"p1","field":"status","from":"todo","to":"doing"}
```

Properties (intended):
- `rows.ndjson` remains canonical; the log is purely additive.
- Append-only, line-diffable, plays nicely with git on top.
- Apps that care implement it; apps that don't, ignore it.
- Readers MUST tolerate absence; MAY ignore unknown `op` values.

This shape is **not normative until specced**. Don't write tooling
against it yet.

**Why park rather than spec now:** specifying a versioning model
before a real consumer has built against it bakes assumptions we
don't have signal for. The format stays lean; the first concrete
history UX in a consuming app gets to drive what the extension needs
to look like.

## D15: SQLite cache — hash staleness, full rebuild, atomic swap

The `index.sqlite` contract (SPEC section 8): staleness is detected by
content hash (`schema_hash` + `rows_hash` stored in a `_meta` table
inside the index), rebuilds are whole-file inside one transaction,
and writers build into a temp file then atomically rename. FTS5
indexes string fields **and** body contents.

**Why hashes, not mtimes:** git rewrites mtimes on checkout/pull even
when content is unchanged — an mtime check rebuilds after every git
operation. Hashing a multi-MB NDJSON costs ~50ms, paid once per open.

**Why full rebuild:** at this format's size class (Airtable caps at
50k rows/base) a transactional rebuild is sub-second. Incremental
indexing is deferred until a real consumer outgrows that — the
format is already incremental-friendly (append-only edits detectable
by prefix hash + byte watermark) if that day comes.

**Why FTS over bodies:** `searchRows` already searches bodies; an
index that omitted them would silently return fewer hits than the
fallback it replaces.

## D16: `queryIndex` takes the view AST, not raw SQL

The original locked interface was `queryIndex(dirPath, sql)`. Changed
(while still a stub, before any consumer existed) to a structured
`IndexQuery` — the `filter` / `sort` shapes from views.json plus a
`search` string — compiled to SQL internally.

**Why:** raw SQL freezes the cache's internal layout (column naming,
encodings, FTS config) into a public contract — the very thing
"never the source of truth" exists to prevent. The AST keeps the
indexed path and the in-memory fallback speaking one query language
so results can't diverge, and user search text never reaches an SQL
string.

## D17: Sync posture — op-log transport, files as materialisation

For multi-writer sync (Hypercore/Autobase per workspace-p2p-spike),
the intended model is an op log per writer, Autobase linearisation,
per-field last-writer-wins, and the `.table/` directory materialised
from the log as a deterministic checkout. Within a synced workspace
the log is canonical and files are derived — which D14 already
permits, since the authority model belongs to the consuming app.
Full reasoning in docs/STORAGE-AND-SYNC.md.

Three knock-on rules recorded here because they constrain the
*format*, not just consumers:

- **Canonical write order** (SPEC section 3): identical state must produce
  byte-identical files, or convergence can't be hash-checked and git
  sees phantom diffs.
- **Append-only schema evolution is load-bearing for sync**, not just
  for compatibility: field *adds* commute between concurrent writers;
  renames/removes would not. Don't relax it.
- **`modified_at` is stamped on user-initiated writes only**
  (SPEC section 5): a sync engine touching it on every apply makes every
  replica differ by timestamp alone.

The reserved `history.ndjson` (D14) and the sync op log are one
design: if the extension lands, it is the at-rest serialisation of
the same event vocabulary, not a parallel format.

## D18: Enum entries are string-or-object

An `enum` entry is either a bare string or an object
`{ value, color?, label? }`. Only `value` participates in validation
and enum-ordered sort/group; `color` (symbolic 8-color palette) and
`label` are display-only. Readers coerce strings to `{ value }` via
`enumOptions()`; both forms may mix in one array.

**Why:** the flat string array couldn't capture author intent
("active = green"), so every consumer picked chip colors
algorithmically and two consumers disagreed. Putting the intent in
the schema makes it round-trip. Object-or-string (rather than a
parallel `enumConfig` map keyed by value) keeps the common minimal
case a plain string and the declaration in one place. Colors are
symbolic, not hex, so each consumer themes them for light/dark.

## D19: `format` is a closed vocabulary, not printf

Field `format` tokens come from a fixed per-type set (number:
`decimal:N` / `percent` / `currency:<ISO>` / …; date: `short` /
`long` / `relative` / …; string: `markdown` / `url` / `email` / …).
Stored values stay raw; `formatValue()` renders locale-aware via
`Intl`. Unknown tokens fall back to plain.

**Why:** arbitrary format strings (Excel's `#,##0.00;[Red]`) are a
mini-language every reader must reimplement identically or diverge —
and they bake locale assumptions into the data file. A closed enum of
*semantics* ("this is USD", "show this date short") lets each
consumer render correctly for its own locale. Reuses the existing
`format` key (already `"markdown"` on strings) rather than adding a
second display-hint field.

## D20: Multi-target relations via `cardinality`, not a new type

Relations stay a single primitive (see D10). Multi-target is a
`cardinality: "one" | "many"` flag on the existing `relation`
declaration; `"many"` means the row value is an array of ids.
Defaults to `"one"` — backwards compatible.

**Why:** "one project" and "many tags" are the same relation concept
at different arity, not two different field types. A flag keeps the
one relation primitive intact and the address grammar unchanged (each
id still resolves to `<path>#row=<id>`), so navigation works for both
shapes with no new machinery.

## D21: Computed fields — reserved shape, deferred evaluator

A `computed: { expr, dialect }` field declaration is reserved in the
spec and the `Field` type, but no evaluator ships. Results are
defined as **never persisted** (recomputed on read); readers tolerate
the field's presence and render it empty until an evaluator exists.

**Why:** the *storage* decision (computed = derived, never written)
is safe to lock now and prevents a "stored value disagrees with
recomputation" staleness class. The *evaluation* decisions — which
expression dialect (CEL / JSONata / bespoke), the standard library,
whether cross-row aggregation is ever in scope — need a real consumer
to drive them; committing early bakes a language we can't yet
justify. Same park-with-reserved-shape posture as D14's
`history.ndjson`. Explicitly out of scope even when built:
spreadsheet-style range references (`A1:A10`) — position-based
addressing is wrong for an id-keyed row model.
