# Storage and sync

How a `.table/` relates to databases and replication. This is
**implementation guidance for consumers**, not normative spec — the
format itself stays storage-agnostic (SPEC section 8 prescribes only the
cache fallback rule; SPEC section 12 / D14 leave data versioning to the
consuming app). It exists so the assumptions behind those decisions
are written down rather than implied.

Companion docs: SPEC section 3 (canonical write order), SPEC
section 8 (the SQLite cache contract), DECISIONS D14–D17, and the
workspace-p2p-spike repo's FINDINGS.md (Hypercore viability across
Node / macOS).

## 1. The three storage tiers

```
text layer        schema.json + rows.ndjson + bodies/ + …
                  → canonical interchange + at-rest form
                  → git-diffable, human-readable, portable

device cache      index.sqlite (per .table/) or an app-level DB
                  → the query hot path on every device
                  → rebuildable, disposable, never authoritative

server projection optional; Postgres or anything else
                  → org-wide search, automations, thin clients
                  → just another consumer of the same data
```

Each tier is a **projection of the one below it conceptually** —
nothing in a higher tier is authoritative over the text layer (or,
in a synced workspace, over the op log; see section 3).

## 2. SQLite as the device database

SQLite is the right device store at every scale that fits on a
device, and the architecture — not row counts — is why:

- **Concurrency profile.** Local-first means per-device, per-user,
  effectively single-process. The multi-writer contention that
  motivates a server database never materialises on-device. WAL mode
  gives concurrent readers + one writer, which is the whole workload.
- **Actual limits.** SQLite handles multi-GB databases and millions
  of rows on phone hardware; FTS5 covers search. For calibration:
  Airtable caps at 50k rows/base (250k enterprise); Notion databases
  degrade well before 100k. A 100k-row table is ~50MB of NDJSON —
  parses in about a second, hashes in ~50ms, queries in milliseconds
  once indexed.
- **The text layer bottlenecks first.** Whole-file rewrite per save
  hurts before SQLite does. When a table outgrows that, the answer is
  not a bigger database — it's moving the hot path to the cache/log
  and demoting `rows.ndjson` to snapshot/export, which SPEC section 8
  already permits ("apps decide their own caching strategy").

Platform drivers: Node has `node:sqlite` built in (≥22) — the Node
implementation can be zero-dependency. React Native: op-sqlite or
expo-sqlite. Browser: wa-sqlite over OPFS, or no cache at all — the
in-memory query path (`applyView` / `searchRows`) is always
sufficient and is what the demo apps use today.

## 3. Sync — log as transport, files as materialisation

`.table/` is a **state-based** format; Hypercore (and any
event-sourced transport) is an **append-only log**. There are two
honest bridges:

**File-level replication** (e.g. Hyperdrive): treat the directory as
blobs, last-writer-wins per file. Trivial, but two peers editing
different rows of the same `rows.ndjson` conflict at file
granularity. Viable only for single-writer / many-reader publishing.

**Op-log transport** — the intended model:

- Each peer owns a writer log of row-level operations
  (`set` / `insert` / `delete`, schema ops, view ops, body and
  attachment references).
- Autobase linearises the multi-writer logs into one causal order
  (validated in workspace-p2p-spike).
- Every peer applies the linearised ops to materialise the `.table/`
  locally — the directory becomes a deterministic *checkout* of the
  log, the way a working tree is a checkout of git history. The
  SQLite cache can even be the materialisation target directly, with
  NDJSON written as the export surface.
- **Conflict semantics:** per-field last-writer-wins on the causal
  order. Sufficient for structured records (the Figma/Linear class
  of sync); long-form *body* text wants real text merging and is a
  separate problem with separate tooling.
- **Attachments** ride the blob layer (Hyperblobs/Hyperdrive),
  content-addressed; D7's filename-only convention accommodates that
  unchanged.
- **Snapshots:** a materialised `.table/` doubles as the compaction
  snapshot — new peers fetch snapshot + log tail instead of
  replaying full history.

### The authority inversion, stated plainly

Within a synced workspace **the log is canonical and the files are
derived**. This does not contradict the spec: SPEC section 12 / D14 already
delegate the data-versioning model to the consuming app, and the
on-disk `.table/` remains the interchange/at-rest surface either
way. What makes the two worlds compose is **deterministic
materialisation** (SPEC section 3, canonical write order): identical log
state must produce byte-identical files, so convergence is checkable
by hash and git sees no phantom diffs.

### `history.ndjson` and the op log are the same thing

D14's reserved event shape —

```json
{"id":"e_xyz","at":"…","by":"leslie","op":"set","row":"p1","field":"status","from":"todo","to":"doing"}
```

— **is** an op-log entry. If/when the history extension is specced,
it should be designed as the at-rest serialisation of the sync op
log, not as a parallel format. One event vocabulary, two transports
(a file in the directory; a Hypercore feed).

### Properties the format already got right

- **Append-only schema evolution** (SPEC section 2: never remove, never
  rename — add + deprecate) is exactly the constraint that makes
  concurrent schema edits *commute*: two peers adding different
  fields merge trivially. Renames or removals would not. Do not
  relax this rule; it is load-bearing for sync, not just for
  backwards compatibility.
- **Enum additions** are a set-union — also commutative. Enum
  *reorder* is not, which is consistent with it being the canonical
  example of a `schema-version` bump.
- **`modified_at`** must only be stamped on user-initiated writes
  (SPEC section 5) — a sync engine touching it on every apply turns it into
  a permanent conflict generator.

## 4. The Postgres question

**Stick with SQLite.** Postgres is not an upgrade path on this
architecture; it is a different architecture. In a local-first
design the database is per-device, and the concurrency that
justifies a server database never appears on a device.

Postgres legitimately enters only with a **server-side surface**:
web clients without local storage, org-wide search across thousands
of tables, automations/webhooks, analytics. And when it does, it
enters as *another consumer of the same op log* — a projection,
exactly like each phone's SQLite. The moment a server database
becomes authoritative, the product has silently become cloud-first
(that is Coda's architecture, and a product decision, not a storage
upgrade). The `.table/` format is indifferent either way: it remains
the interchange and at-rest layer, whatever sits above it.

## 5. What stays out of the format

Same posture as D4/D14, restated for this domain: the spec defines
the text layer and the cache *contract*; it does not name a sync
protocol, a database engine, or an authority model. Those belong to
consumers — this document records the recommended shape so
consumers don't each re-derive it.
