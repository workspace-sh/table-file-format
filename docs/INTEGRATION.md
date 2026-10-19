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

- **`@workspace.sh/table-gtk`** (optional, Linux) — the same views for
  GTK4 and libadwaita, through GTKX, with the same names and props
  (`ViewProps`). An app wires one set of callbacks and hands them to
  either library. It needs GTKX and the app's generated bindings, so it
  is typechecked and tested inside a GTK app (`apps/linux`), and a GTK
  app bundles it from source.

- **`@workspace.sh/table-ui/shared`** — what every renderer shows,
  with no renderer in it: `describeCell` (what a value shows as),
  `columnWidths`, `groupedRows`, `totalFor`, the pill palette, cell
  checks, and the `ViewProps` type. Rendering your own views on
  another toolkit? Build on this, and a table shows the same there.

- **`@workspace.sh/table-app`** — what an app around the views does:
  tables held by `bundle/table` key, `showView` (the rows a view shows,
  after a viewer's own sort and search, and a Sheet view's saved grid),
  a viewer's arrangements, display settings, saved state over any
  key-value store, and single-file `.table`s. `@workspace.sh/table-app/node`
  opens `.table` folders from disk (`loadLibrary`).

### A table inside a document

To show a `.table` inside something else (a Markdown file that links to
it), an app places one drop-in and gives it the link:

- **`embedIn(library, address, fileName)`** in `table-app` says what a
  link's address names in a file just read: which table and view, or why
  it can't be drawn, in words for the reader. Every drop-in asks it, so a
  link draws the same thing and fails with the same words everywhere.
  What it answers carries `size`: the `rows=` or `cards=` the address asks
  to be shown at once (SPEC section 10), for the drop-in to size itself by.
  With `rest=more` in it the drop-in draws only that many: `embedCount`
  says which count the layout shows, `embedLeftOut` how many it leaves
  out, and `embedMoreText` what the line that shows them says. With
  `width=full` (`size.width`) a table's columns share the whole width
  rather than stopping at their natural widths: the drop-in passes
  `fillWidth` to the view.
- **`useEmbeddedTable(shown, files)`** in `table-app/react` holds what it
  names over the app reducer: the views' props and callbacks, with edits
  written through `files` (how the platform writes a bundle and appends
  to a history) and whatever is still to write written when it goes.
- **`readEmbed({ address, baseDir, within })`** and **`embedFiles`** in
  `table-app/node` are those two over node:fs: the path resolved against
  the document's folder and kept inside `within`.
- **`TableEmbed`** in `@workspace.sh/table-gtk/embed` is the GTK drop-in
  over them (see that package's README). **`TableEmbed`** in
  `@workspace.sh/table-app/embed-view` is the drop-in for `table-ui`'s
  views (web, iOS, Android, macOS): the same hook with those views and
  the platform's own files. It holds a table of 50,000 rows or more in
  memory, not through the index (#515).

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

On a platform without node:fs (React Native, a browser with a file-system
API), the same reader and writer run over a `TableFs` you supply: seven
async file operations (`readText`, `writeText`, `rename`, `mkdir`, `list`,
`remove`; see `@workspace.sh/table-core/io`). `readBundle(fs, dir)`,
`readTable`, `writeBundleTo` and `writeTableTo` are what `parseBundle` and
`writeBundle` run over node:fs. Your `rename` must replace an existing file
atomically, as POSIX rename(2) does, or the writer loses its per-file
guarantee. `memoryFs()` is one held in memory, for tests. table-app's
`openLibrary(fs, paths)` and `writeLibraryBundle` do the same for an app's
`bundle/table` map.

In a browser (no filesystem), skip `parseTable` and build the
`ParsedTable` yourself from fetched/bundled file contents — the demo
web app does exactly this (`apps/web/src/loadFixture.ts`).

## Writing a table

`writeTable(dir, { schema, rows, views, meta, bodies })` implements
the writer-atomicity contract (SPEC section 1): stage to `*.tmp` →
atomic per-file rename → deletions last. A crashed write leaves the
previous table intact; readers never observe a torn file. Do not
hand-roll writes that bypass this unless you replicate the contract.

To show values, `formatValue(field, value, { locale, dateFormat })` renders
a field's `format` with `Intl`. `locale` and `dateFormat` are the viewer's
own preferences and are never written to the table. `dateFormat` applies
only to date fields with no `format` of their own; a field's own format
always wins. In the UI package, `DisplaySettingsProvider` hands them to every
cell.

To start a table from nothing, `newTable(title, path)` returns one with a
`title` text field, one table view and no rows, its manifest stamped.

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

## A `.table` as a single file

A `.table` is a folder or a single file, the same document either way
(SPEC section 13, D49, D50), told apart by what's on disk. Portable:
it works on Node, in browsers, and in React Native (Hermes), so a
`.table` sent as one file opens on every Workspace platform:

```ts
import { readTableDocument, writeTableFileTo, readTableArchive, writeTableArchive } from "@workspace.sh/table-core";

const { form, bundle } = await readTableDocument(fs, path); // "folder" or "file", by what's on disk
await writeTableFileTo(fs, path, bundle);                  // a single file, written beside it and renamed over it

const read = await readTableArchive(bytes);                // a single file's bytes, as a ParsedBundle
const out = await writeTableArchive("projects", read);     // and back: canonical <name>.table/ layout, deterministic
```

To edit a single file in place, `@workspace.sh/table-app`'s
`unpackTableFile` and `packTableFile` keep it as a working folder in
the app's own storage and pack it back after each write.

Callers supply bytes (`await readFile(p)` on Node, `File`/fetch on
web, the document picker on RN). Reading is fully in-memory (no
extraction, no zip-slip exposure); hostile entry names and
decompression bombs are rejected. Layout and security rules: SPEC
section 13.

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
2. Iterate the files in `rows/` in name order, line by line,
   skip-and-collect on bad lines (SPEC section 3, "Reader error
   contract"); a `formatVersion` 1 table has one `rows.ndjson` instead.
3. Tolerate every optional file being absent; ignore unknown files.

Everything else — views, bodies, attachments, the SQLite cache — is
progressive enhancement. A Rust reference core is tracked in
issue #19.
