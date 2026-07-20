# Integrating `.table/` — a consumer's guide

Written for the Workspace app team (and any other consumer). The
format is **frozen at `formatVersion: 1`** (tag `format-v1`,
DECISIONS D26): the bytes are stable, additive-only from here. The
TypeScript API below is what the reference library ships today; it
may still evolve ahead of a 1.0 package release, but every contract
it implements is spec-frozen.

## What to depend on

- **`@workspace.sh/table-core`** — the format library. Pure TS, no
  UI. The barrel is browser/RN-safe; filesystem IO lives behind
  subpaths so bundlers never pull `node:fs`:

  ```ts
  import { validate, applyView, searchRows, newId } from "@workspace.sh/table-core";
  import { parseTable } from "@workspace.sh/table-core/parser";   // Node only
  import { writeTable } from "@workspace.sh/table-core/writer";   // Node only
  ```

- **`@workspace.sh/table-ui`** (optional) — react-strict-dom view
  components (TableView, BoardView, GalleryView, ListView,
  CalendarView, SchemaFieldEditor, BodyEditor) rendering on web +
  RN + RN-macOS. Consume it if you want the reference views;
  rendering your own on top of core is equally supported.

Resolution is verified on all three loaders: **Node ESM** (`default`
condition → `dist/`, explicit `.js` specifiers), **Vite** (`source`
condition → `src/*.ts`; production build green), **Metro**
(`react-native` condition → `src/*.ts`; the mobile and macOS demo
apps are the living proof).

## Reading a table

```ts
const table = await parseTable("path/to/projects.table");

// 1. Parse-level diagnostics — the reader is skip-and-collect
//    (SPEC section 3): malformed lines and id-less rows are skipped
//    and reported here, never thrown. Missing/malformed schema.json
//    is the one fatal case.
if (table.diagnostics?.length) surfaceToUser(table.diagnostics);

// 2. Constraint validation — types, enums, ranges, primary keys.
const errors = validate(table.schema, table.rows);

// 3. Views — filter/sort/group/order exactly as saved in views.json.
const view = table.views[0];
const rows = applyView(table, view);

// 4. Search — string fields + long-form bodies.
const hits = searchRows(table.rows, query, { schema: table.schema, bodies: table.bodies });
```

In a browser (no filesystem), skip `parseTable` and build the
`ParsedTable` yourself from fetched/bundled file contents — the demo
web app does exactly this (`apps/web/src/loadFixture.ts`).

## Writing a table

`writeTable(dir, { schema, rows, views, meta, bodies })` implements
the writer-atomicity contract (SPEC section 1): stage to `*.tmp` →
atomic per-file rename → deletions last. A crashed write leaves the
previous table intact; readers never observe a torn file. Do not
hand-roll writes that bypass this unless you replicate the contract.

Rules that matter when constructing rows:

- **Ids**: any non-empty string unique in the table is valid; mint
  with `newId()` (25-char lowercase base36 — case-safe because ids
  become `bodies/{id}.md` filenames; SPEC section 3). Never reuse or
  rename an id — relations and addresses point at it.
- **Schema evolution is append-only**: add fields, mark old ones
  `deprecated: true`; never remove or rename (SPEC section 2). Bump
  `schema-version` on structural change — and treat it as advisory
  outside single-writer contexts (DECISIONS D22).
- **Canonical write order** (SPEC section 3): keep row insertion
  order stable and key order consistent so identical state produces
  identical bytes.

## CSV in / out

`fromCSV(csv, schema?)` (RFC 4180, schema-coerced or inferred, ids
minted when absent) and `toCSV(table)` — call
`csvExportWarnings(table)` first and show the result: relations,
attachments, and bodies do not survive a CSV export, and the loss
must be visible, not silent.

## Archives (`.table.zip`)

For transport contexts that can't carry a directory:

```ts
import { readTableArchive, writeTableArchive } from "@workspace.sh/table-core/archive"; // Node only

const table = await readTableArchive(zipPathOrBytes); // same ParsedTable + diagnostics as parseTable
const bytes = await writeTableArchive("projects", table); // canonical <name>.table/ layout, deterministic
```

Reading is fully in-memory (no extraction, no zip-slip exposure);
hostile entry names and decompression bombs are rejected. Layout and
security rules: SPEC section 13.

## What stays OUTSIDE the `.table/`

Per-user state (open view, scroll position, column widths tweaked
locally, pinned views), ACLs, and computed view results. `views.json`
is shared/team state only (DECISIONS D4). Access control is a
consumer/sync concern (docs/PERMISSIONS.md — design stage); the
format itself has no private layer (docs/PRIOR-ART.md).

## Platform notes

See "Platform realities" in docs/ARCHITECTURE.md: macOS document
packages (declare the UTI to get one-item Finder behaviour), iOS
file-provider caveats, Android SAF tree URIs, zip-for-transport, and
case-insensitive checkout notes.

## Sync comes later — and changes nothing here

The P2P layer (Hypercore/Autobase, docs/STORAGE-AND-SYNC.md)
materialises **the same files** this guide reads and writes. Code
written against `parseTable`/`writeTable` and the contracts above
will not change when sync lands — files are the interface, by
design (DECISIONS D17). Do not couple consumer code to a transport.

## Minimum viable reader (non-JS consumers)

To claim `.table/` support, an implementation needs only:

1. Parse `schema.json` (fatal if missing/malformed).
2. Iterate `rows.ndjson` line-by-line, skip-and-collect on bad lines
   (SPEC section 3, "Reader error contract").
3. Tolerate every optional file being absent; ignore unknown files.

Everything else — views, bodies, attachments, the SQLite cache — is
progressive enhancement. A Rust reference core is tracked in
issue #19.
