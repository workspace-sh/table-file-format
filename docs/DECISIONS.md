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

## D22: `schema-version` is single-writer scoped

The `schema-version` counter is meaningful only without concurrent
writers (one device, or git with human-resolved merges). Under
multi-writer sync it is **advisory**: the sync layer's linearisation
order is authoritative for schema supersession, and consumers must
not treat counter equality as schema equality across replicas —
compare the field set itself. (Resolves issue #45; follows from the
D17 op-log model.)

**Why:** a monotonic counter cannot converge — two offline peers can
both bump 1 → 2 with different schemas, and on sync there are two
distinct "v2"s. The honest options were: derive the version from
content (loses the human-readable number), hand it to the sync layer
(leans on a layer that isn't built), or scope the counter to the
substrate where it works. The append-only schema rule (D18) already
makes concurrent schema *edits* commute; only the *number* was lying.
Scoping it is zero-code, honest, and correct for the 1.0 substrate
(git / single device). When the sync layer lands, it owns
supersession by log position — the counter stays what it is today: a
human-facing "the schema changed" signal.

## D23: Ids are case-safe; validity is loose, minting is opinionated

Writer-minted ids are 25 chars of lowercase base36 (`0-9a-z`,
~129 bits) via `customAlphabet` — no uppercase anywhere in the
alphabet. Validity stays loose: any non-empty string unique within
the table is a legal id, so hand-authored ids (`p1`) remain fine.
(Resolves issue #42.)

**Why:** ids are used verbatim as filenames (`bodies/{id}.md`), and
the default nanoid alphabet mixes case — on case-insensitive
filesystems (default APFS, NTFS, most sync targets) two ids differing
only in letter case resolve to the same path and silently overwrite
each other's bodies. Silent data loss is the worst failure mode, so
the fix removes the failure *class* (case leaves the alphabet)
rather than adding a filename-encoding layer both writer and parser
would carry forever. Length went 21 → 25 to keep entropy at parity
with the old base64url alphabet. Breaking for previously-minted
mixed-case ids, which is acceptable pre-1.0 — no production data
exists, and fixtures use hand-authored ids that were never affected.
The loose-validity rule is deliberate (maintainer call): a `.table/`
outside a managed workspace should be writable by a human or an
agent without opaque-id ceremony.

## D24: Writer commits via stage → rename → trim

`writeTable` stages every file to a `<name>.tmp` sibling, commits
each with an atomic per-file `rename()`, and performs deletions
(stale bodies, emptied `bodies/`) only after every rename has
landed. A failure during staging aborts with the previous table
byte-for-byte intact. (Resolves issue #43.)

**Why:** the old writer wrote each file in place, sequentially — a
crash, a concurrent reader, or a file-sync client could observe a
new `schema.json` alongside the old `rows.ndjson` (a torn table),
and a crash mid-bodies could leave bodies deleted but not
rewritten. For a format whose pitch is local-first files under git
and sync clients, the writer must never make a reader's view
inconsistent. Full-directory swap (staging a sibling directory and
renaming it into place) was considered and rejected for 1.0: it
breaks open file handles and watchers on every save and costs a
directory copy for unchanged attachments; per-file rename shrinks
the torn window from "the whole serialisation" to a handful of
renames, which is proportionate. Durability (fsync) is explicitly
out of scope — the contract is about what readers can observe, not
about power loss; the same posture as the `index.sqlite` rule
(D15).

## D25: Readers are skip-and-collect, not fail-fast

`parseTable` skips a malformed NDJSON line, a row without a system
`id`, or a malformed optional file, and reports each as a diagnostic
(`ParsedTable.diagnostics`, `ValidationError` shape, `rowIndex` =
zero-based line number, or −1 for file-level). Valid rows always
load. The single fatal case is a missing or malformed `schema.json`.
(Resolves issue #44.)

**Why:** the format's pitch is hand-editable, line-diffable text
under git. Fail-fast meant one typo or a merge-conflict marker made
the entire table unreadable — an exception, with no way to see the
surviving data. That punishes exactly the users the plain-text
design courts. Skip-and-collect matches NDJSON's own design (each
line independently parseable, SPEC section 3) and the format's
existing tolerance posture (optional files may be absent; unknown
root files are ignored). Strictness remains available one level up:
a consumer can refuse to proceed when `diagnostics` is non-empty.
Schema stays fatal because every downstream interpretation depends
on it — degrading there would fabricate meaning.

## D26: formatVersion 1 is frozen (2026-07-20)

The on-disk format is frozen at `formatVersion: 1`, tagged
`format-v1`. Changes from here are additive only — new optional
fields, annotations, or files that existing readers safely ignore
(the tolerance rules in SPEC section 1 make this cheap). Breaking
changes require a major `formatVersion` bump. The reference
library's TypeScript API is versioned separately and may still move.

**Why now:** every open vocabulary question is implemented or
reserved-with-a-shape (D18–D21), the storage/sync contracts are
written (D15–D17, D22), the reader/writer behaviour contracts are
implemented and tested (D23–D25), the architectural review
(docs/REVIEW.md) found no remaining freeze-blockers after the
access-model reconciliation landed, and the first real consumer
(the Workspace app) is waiting on a stable target. A frozen format
with an evolving library is the correct boundary: consumers bet on
bytes, not on npm semver.

## D27: Archive transport — nested root, in-memory reader, zero deps

`<name>.table.zip` contains exactly one root directory,
`<name>.table/` (SPEC section 13). The reference reader parses the
zip entirely in memory — never extracting to disk — and the writer
emits byte-deterministic archives. Zip handling is ~200 lines over
`node:zlib`; no archive dependency. (Resolves issue #56, requested
by the Workspace integration.)

**Why nested, not files-at-root:** Finder and CLI `unzip` both then
produce the `.table/` directory directly, nothing scatters loose
files into the extraction directory, and the table keeps its name
when the archive file is renamed. **Why in-memory:** it makes the
zip-slip vulnerability class structurally impossible in the
reference path (entry names are still validated for extracting
consumers), avoids temp-directory lifetime questions, and a
`.table/` that fits an email fits memory. **Why zero-dep:** the
format's pitch is implementable-in-an-afternoon; stored + deflate
over a fixed layout doesn't justify an archive stack. Constraints
accepted: no zip64, no encryption — readers MAY reject >4 GiB
archives.

## D28: Archive transport is portable; codec via fflate

`readTableArchive` / `writeTableArchive` run on Node, browsers, and
React Native (Hermes): no Node globals, bytes-only API (the platform
supplies bytes from a path, fetch, or document picker), string
encoding via fflate's helpers rather than assuming global
TextEncoder/TextDecoder. The raw-deflate codec is `fflate` (pure JS,
zero transitive deps); the container logic — layout, security
posture, determinism — remains bespoke. Supersedes D27's
zero-dependency claim.

**Why:** a shared archive arrives on every platform — mail on a
phone, upload in a browser, Finder on a Mac — so a Node-only reader
served exactly one of the format's three UI targets. Hermes has
neither `node:zlib` nor `DecompressionStream`, which leaves pure-JS
deflate as the only implementation that runs everywhere; writing and
maintaining our own inflate/deflate is not where this format's value
lives. fflate is small, audited, and dependency-free, and only the
codec crosses the boundary — everything the spec normatively
constrains stays in-repo.

## D29: Computed field dialect — `table-expr-v1` is a canonical S-expression grammar; Excel-style syntax is a compiling authoring surface

The `dialect: "table-expr-v1"` placeholder in D21/SPEC section 2 is
defined: an S-expression (EDN-style) grammar — `(sum price quantity)`,
`(if (> total 4200) "over" "ok")` — as the one form every reader's
evaluator parses. `dialect` remains a string precisely so a future
`table-expr-v2` or an entirely different grammar can be introduced
without a `formatVersion` bump; `table-expr-v1` names this first one.

No second stored grammar is introduced. Excel-familiar syntax
(`=SUM(price, quantity)`) is an **authoring-surface convenience**,
not a storage format: a consuming app's editor compiles it down to
`table-expr-v1`, and renders the stored form back into Excel-style
syntax when it shows it. The file holds one formula in one notation.

**Why no cached rendering beside `expr`:** a client able to compile
`=SUM(price, quantity)` down can equally print the stored form back,
and printing is the easier of the two directions. Storing a second
copy would save a consumer a few dozen lines, at the cost of a value
that can silently disagree with the formula it describes. The format
already refuses that trade for computed results ("never persisted,
recompute on read"); a cached rendering is the same staleness in a
different field, and is refused for the same reason. This is a
deliberate omission — do not reintroduce a `display` key as a
convenience.

**Case:** function names are case-insensitive at the authoring surface
and normalise to lowercase in the stored `expr` — `ROUND(price, 2)`,
`Round(price, 2)` and `round(price, 2)` all compile to
`(round price 2)`. Uppercase
is a spreadsheet typing convention, not a requirement, and carrying it
into storage would oblige every reader to case-fold before dispatch.

Field references and string literals are case-**sensitive** and
preserved verbatim. A field reference is a key in `rows.ndjson`, so
`price` and `Price` are genuinely different fields and nothing can
safely guess which was meant; folding them would silently resolve to
the wrong column. Readers MUST NOT case-fold anything but the
function position.

**Why S-expressions over CEL, JSONata, or a bespoke infix grammar:**
the format's pitch is a minimal reader implementable in an afternoon
(D9, D26's freeze rationale). CEL and JSONata both need real
tokenizers with operator-precedence climbing before anything can be
evaluated; an S-expression reader is closer to a hundred lines in any
language — no precedence table, no ambiguity, `(op arg arg…)`
uniformly. That cost is paid by every third-party reader that wants
to resolve a computed field, not just this repo's own.

**Why not restricted/sandboxed JS:** same reason in sharper relief —
even a minimal secure-subset JS parser is a substantially bigger
implementation surface than an S-expression reader, for a format
whose whole thesis is implementer accessibility.

**Why one stored grammar rather than a dialect per column:** `dialect`
already makes multiple grammars representable, but every additional
*stored* grammar is an interpreter every compliant reader must embed
to be spec-compliant — directly opposed to the minimal-reader thesis.
Mixing is fine at the *authoring* layer (one column's formula typed
via an Excel-style bar, another hand-written in `table-expr-v1`
directly) because both compile to the same stored `expr`; it is a
cost only when the *storage* layer forks.

**Precedent:** Grist (Python formulas, Excel-named functions exposed
as callables in the same language) solves the "don't alienate
spreadsheet users" problem the same way — one execution language, a
familiar vocabulary layered on top — rather than by shipping two
interpreters.

**Composability payoff:** because `table-expr-v1` expressions are
pure (no side effects, no cross-row state beyond what's explicitly
referenced), they would compose cleanly with a future multi-value
("amb") scenario extension, should one be reserved — such an
evaluator re-runs the same `expr` once per input combination with no
special-casing. Nothing of the kind is reserved today; this notes a
property worth preserving, not an existing commitment.

**Coordinates are an authoring and display surface, never storage:**
a grid MAY label columns `A, B, C…` and rows `1, 2, 3…`, and a formula
bar MAY accept `=B7`. Neither reaches disk. A coordinate typed at entry
is resolved immediately against the current view to a stable reference
— the field name, plus a row id when it points at another row — and
that is what is stored. On display the stored reference is rendered
back into whatever coordinate it occupies in the current view.

The formula therefore never changes when rows are sorted, filtered or
grouped; only its rendering moves. `=B7` becomes `=B3` after a sort,
still meaning the same row. This is strictly stronger than A1: a
spreadsheet must rewrite every affected formula on an insert or delete
(O(formulas) per structural edit) and still cannot protect references
that point INTO a sorted range from outside — they keep their
coordinate and silently mean different data. A reference bound to a row
id cannot be broken by reordering at all, so there is no rewriting pass
and no `#REF!` arising from a sort. This extends D21 rather than
adding to it: D21 already rules out spreadsheet-style range references
(`A1:A10`) on the grounds that position-based addressing is wrong for
an id-keyed row model. The same reasoning applies to a single
coordinate, which is why one may be typed and displayed but never
stored.

**Row-local evaluation is a performance boundary, not only a scope
decision:** while a computed field may reference only its own row
(D21, issue #34), each row's evaluation is independent and there is no
cross-row dependency graph. Combined with recompute-on-read, this
means a reader computes only the rows it is showing — a million-row
table costs what is on screen, not what is on disk, and recalculation
parallelises per row. Cross-row aggregation is precisely what
reintroduces the dependency graph and the topological recalculation
that makes large spreadsheets slow. That is a reason to keep it
deferred, and when it is built it needs designing against that cost
(incremental aggregates, or materialisation into the optional
`index.sqlite`) rather than treating it as ordinary scope.

(Resolves issue #34.)

**Addendum (2026-09-24): refusal, and what `sum` means.**

- **A formula that can't compile is refused, never stored.** An
  authoring surface compiles what was typed to `table-expr-v1` before
  saving. If it can't, the formula is refused with an error at the
  point of entry, and nothing is written. `expr` never holds raw
  authoring text: a stored infix string would be the second grammar
  this decision rules out, and every reader would have to guess at it.
  A reader given an `expr` that does not parse renders the field empty
  and reports it.
- **`sum` adds its arguments within the row.** `(sum price quantity)`
  is `price + quantity`, and a one-argument `(sum price)` is just
  `price`. It never means a column total. The case example above used
  `SUM(price)` until this addendum and was changed to `ROUND`, because
  a spreadsheet user reads `SUM(price)` as a column total. Cross-row
  aggregation is still deferred, for the performance reasons above;
  when it arrives it gets its own form rather than overloading `sum`.

## D30: Every field type has exactly one JSON encoding

SPEC section 2 named thirteen field types but said how only some of
them are written. `datetime` did not say whether an offset is
required, `duration` had no grammar, `geopoint` was a two-number array
in the reference validator but a `"lat,lon"` string in the
`index.sqlite` mapping, and `geojson` was a string in the validator
where every other GeoJSON consumer expects an object. Two independent
readers of one file could reasonably disagree about its values. For a
format whose point is being read by software that isn't ours, that is
the most serious kind of gap, so the encodings are now pinned (SPEC
"Value encodings", "Empty values", "Numbers").

**Standards, not inventions.** Dates and times are RFC 3339; durations
are ISO 8601; `geojson` is RFC 7946; `geopoint` is `[longitude,
latitude]`, GeoJSON's order and Frictionless's array form. A third
party can check a value with a library they already have.

**`datetime` offsets are optional.** With one, the value is an
instant, and writers SHOULD spell instants in UTC so that equal values
are byte-identical. Without one, it is a floating wall-clock time,
as in iCalendar: "the stand-up is at 09:30" means 09:30 wherever the
reader is, and forcing an offset would misstate it. What IS required
is that readers compare instants, not strings; the reference sort
compared strings, which misorders `10:00+02:00` against `09:00Z`.

**Seconds are required** in `time` and `datetime`, although HTML's own
inputs omit them. Allowing both would give `09:30` and `09:30:00` as
two spellings of one value, which breaks the byte-identical guarantee
of canonical write order. The reference provides `completeSeconds()`
for writers fed by those inputs.

**Numbers are doubles, and the spec says so.** This matches what
spreadsheet applications do, but was never stated. Integers are bound
to ±(2⁵³−1), where common JSON parsers start rounding silently. An
exact decimal type is deliberately not added here: it is a real
design question (string-encoded? a scale on the field?) and belongs
with the formula work that would compute on it.

**Absent, `null` and `""` are one "empty".** The reference already
treated them alike in validation, filters and grouping, but sorted
`""` as an ordinary string — first when ascending. It now sorts last
in both directions, like the other two, and writers SHOULD omit the
key.

**Additive under D26.** No fixture in this repository uses any of the
newly pinned types, so no stored value changes meaning. `geojson` now
reads both the object and the old string form. One reference writer
did produce a now-refused spelling: the table view's cell editor saved
`time` and `datetime` without seconds, straight from the browser
input. It now completes them. Otherwise, the newly refused values are
ones no two readers could have interpreted consistently anyway.

Documented at the same time, because the reference already used them
without the spec mentioning them: the field annotations `title` (the
display name, which is how a column is "renamed" under append-only
evolution) and `align`, and the view properties `group`, `order` and
`columnWidths`.

## D31: Withdrawn — `rows.ndjson` stays one row per line

D31 briefly split `rows.ndjson` into one cell per line with a blank
line after each, so that git could merge edits to neighbouring cells
without a conflict. It is withdrawn, and `rows.ndjson` is one row per
line, as SPEC section 3 has always described.

Every plain-text format lives with git's line-based merges — CSV,
JSON, Markdown, JSON Canvas, source code — and none of them reshapes
itself to avoid conflicts. D31 did, at a real cost: files two to three
times larger, rows no longer readable at a glance, and blank lines that
strict NDJSON and JSON Lines readers reject (JSON Lines: "a blank line
is not" a valid value). Conflicts in a `.table/` are resolved the way
they are everywhere else. Workspace itself doesn't sync `.table/`
through git at all.

There were no users, so nothing reads the withdrawn layout: no
`formatVersion` 2, no migration, no conflict-marker handling in the
reader.

## D32: `table-expr-v1` standard library — spreadsheet names, spreadsheet behaviour

D29 settled the grammar and left the standard library open. The
reference evaluator now defines it (SPEC section 2, "Computed
fields"): arithmetic, comparison, `sum min max round abs`,
`if and or not isblank`, and `concat upper lower len`, row-local only.

**Excel's names and Excel's behaviour, lowercased.** People writing
formulas already know them, and D29's authoring surface compiles
`=ROUND(x, 2)` to `(round x 2)` one-for-one, so no renaming table has
to be learned or maintained. Where Excel's behaviour is a convention
rather than an accident, it is kept: `sum`/`min`/`max` skip blanks,
`round` rounds halves away from zero, `<>` is not-equal, and failures
show as `#DIV/0!`, `#VALUE!`, `#NAME?`, `#REF!` and `#NUM!`.

**One deliberate departure: an empty operand makes arithmetic empty.**
Excel treats a blank as 0, so `price * quantity` with no quantity
shows 0 — a plausible-looking wrong answer in a column of real ones.
Empty-in, empty-out makes missing data visible instead. `sum` still
skips blanks, so "add these up, ignoring gaps" stays one word.

**Errors are values, not exceptions.** A failed row shows its code in
its own cell and the rest of the column still computes; anything built
on a failed value carries the same code, so the first cause is the
one shown. The untaken branch of `if` is never evaluated, so
`(if (= q 0) 0 (/ p q))` guards a division the way it does in a
spreadsheet.

**Left out on purpose:** `today`/`now`, because a formula whose value
changes with the clock is not pure (D29 relies on purity for
recompute-on-read and for any future multi-value extension), and
column totals, which stay deferred for the performance reasons in
D29. Both can be added later without changing anything here.

## D33: Currency is a unit, and nothing converts

`currency:<ISO-4217>` sat in SPEC section 2 as a display format, beside
`percent` and `decimal:2`. It is more than that: it says what the
stored number is *in*. `80000` in a `currency:USD` column is eighty
thousand dollars, and relabelling the column EUR doesn't make it
euros.

Treating it as display alone let a formula column say something false.
`(/ budget 5)` over a USD budget, shown with `currency:EUR`, printed
€16,000 beside US$80,000 as though a conversion had happened. None had.

**Nothing converts.** A `.table/` stores no exchange rates, and a reader
never fetches one: rates change by the minute, depend on a provider,
and would make a formula's result depend on when and where it was
read, which breaks the purity D29 relies on for recompute-on-read.
Converting is a formula over a rate the table holds as data,
`(* budget usd_to_eur)`, so the rate is visible, dated if you like,
and the same for every reader.

**Formulas show their inputs' currency.** A computed field with no
`format` of its own is shown in the currency of the fields it reads,
when they all share one. A formula over dollars is shown in dollars
without anyone setting it. When the inputs are in different
currencies there is no single unit, so the result is shown as a plain
number. A field's own `format` still wins, and an authoring surface
should say, when it differs from the inputs, that it relabels rather
than converts.

**Different columns in different currencies are fine.** A table of
prices by market can hold a USD column beside a EUR one. What the
format refuses is implying that numbers in one were derived from the
other by a rate that isn't there.

Reference: `effectiveFormat()` / `inputCurrency()` in
`@workspace.sh/table-core`.

## D34: Another row is named by its id: `(field "name" "<row id>")`

D29 decided that a coordinate such as `=B7` may be typed and shown but
is stored as the field name plus a row id. That left the stored form
unwritten, so nothing could point at another row. It is the existing
`field` form with a second argument: `(field "q1" "income")` is the
field `q1` of the row whose system `id` is `"income"`. A bare word, and
`(field "name")`, still mean the row being computed.

**Why:** it is D29's own wording made concrete, and it adds one optional
argument rather than a new function, so a reader that already evaluates
`field` needs only to look the row up. The id is the system `id`, which
never changes (D23), so the reference survives sorting, filtering,
grouping and edits to any other field.

**Resolving a typed coordinate.** An authoring surface resolves a
coordinate against the grid it shows. One in the row being edited
becomes a bare field, which means "this row" for every row: a
spreadsheet's fill-down. One in another row becomes
`(field "name" "<row id>")`, which is absolute. Relative offsets such
as "the previous row" are not provided. On display the reference is
shown at whatever coordinate its row now holds, or as
`field("name", "<row id>")` when the row is not in view.

**Errors.** A reference to a row that doesn't exist (deleted, say) is
`#REF!`, as in a spreadsheet: shown, never silently empty. So is a loop
that runs through other rows. Evaluation stays per cell: a formula
reads the cells it names and nothing else, so D29's performance
boundary for cross-row aggregation is untouched.

Reference: `computeRows()` and `formulaRefs()` in
`@workspace.sh/table-core`; SPEC section 2 "References to another row".
