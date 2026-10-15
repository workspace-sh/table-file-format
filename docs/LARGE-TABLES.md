# Large tables

Research notes, not spec. This looks at what happens to a `.table` at 50k to 1M rows: opening it, querying it, storing it, and syncing it. It was gathered on 26 Sep 2026 so a later discussion can start from measurements rather than guesses. Nothing here changes SPEC or DECISIONS on its own.

Companion docs: SPEC section 8 (the `index.sqlite` contract), DECISIONS D6, D15 and D16, [STORAGE-AND-SYNC.md](STORAGE-AND-SYNC.md).

The plan that follows from these numbers, for views reading through the index and for the edit history, is [LARGE-TABLES-PLAN.md](LARGE-TABLES-PLAN.md).

## How it was measured

- **Machine:** Apple M1, 8 GB, Node 22.23 with `node:sqlite`.
- **Data:** deal-shaped rows (title, company link, stage, value, probability, close date, owner, tags, about 200 characters of notes), generated from a fixed seed. Every run produces identical data.
- **Joins:** a 10k-row companies table to join against.
- **Answers:** hashed on every run. Regenerating the data from scratch gave the same answer hash.
- **Caveat:** the text comes from a 28-word vocabulary, so it compresses better than real data. A harder variant (236k words, Zipf distribution) is reported alongside where it matters.

## Opening and querying with SQLite

"Open" is hash, parse, load, three indexes and a full-text index, following SPEC section 8: a temporary file, one transaction, then a swap.

| Rows | `rows/` | Open | `index.sqlite` | View / search / point query | Whole-table totals | Peak memory |
|---|---|---|---|---|---|---|
| 50k | 22 MB | 0.5 s | 31 MB | < 0.1 ms | about 70 ms | small |
| 100k | 44 MB | 0.9 s | 58 MB | < 0.1 ms | about 160 ms | small |
| 500k | 221 MB | 5.0 s | 293 MB | < 0.1 ms | about 1.2 s | 1.5 GB |
| 1M | 442 MB | 10.9 s | 582 MB | < 0.1 ms | 2.6 s | 2.5 GB |

- **Covering indexes fix totals.** At 1M rows, `(stage, value)` and `(company, stage, value)` took a GROUP BY from 2.5 s to 57 ms and a rollup join from 2.8 s to 176 ms. They cost 2.5 s to build and 53 MB. Such indexes can be derived from the schema and views: relation fields, the fields views filter, sort and group on, and their totals.
- **The open cost is paid once per content version.** The index is keyed by content hash, so reopening an unchanged 1M-row table costs the hash, about 0.3 s.

## Where the limits are

The limits are around SQLite, not in it.

1. **Edits.** Rebuilding the whole index on each edit (as SPEC section 8 and D15 first had it) takes under 1 s to about 100k rows and 11 s at 1M, so edits are made in the index in place: a row edit is a statement (`putRows`, `removeRows`), and a change of fields is changed in place and filled in behind (#551, #556, #562).
2. **The file.** One file for every row outgrows git hosts: GitHub blocks files over 100 MB and warns above 50 MB. So a table's rows are files in `rows/`, the writer starting the next once one passes about 25 MB, and never moving rows between them (SPEC section 3, D51, #582). The 1M-row test table, 165 MB, is `0001.ndjson` to `0006.ndjson` at 25 MB and `0007.ndjson` at 15 MB.
3. **Memory.** Parsing everything into objects first peaked at 2.5 GB at 1M rows. Streaming the text straight into SQLite avoids this.

## Engines

The decision (26 Sep 2026) is **SQLite only**, as the index on every device and on the server. DuckDB is parked for this discussion.

- **SQLite has maintained bindings everywhere we ship:**
  - `node:sqlite` or better-sqlite3 for desktop and the server;
  - op-sqlite or expo-sqlite for iOS, Android and macOS;
  - the official wasm build or wa-sqlite for the standalone web demo.

  FTS5 works on all of them. Workspace in a browser is a UI over its own server, so the server's SQLite serves it.
- **DuckDB** queried `rows.ndjson` in place with no build: 92 to 164 ms at 1M rows, answers matching SQLite exactly. Ingested, it builds in 1.8 s to 113 MB, and totals take 2 to 15 ms. Against it:
  - no official mobile binding (only react-native-duckdb, with one maintainer);
  - duckdb-wasm has an OPFS bug in its current npm release;
  - full-text search is a separate download;
  - D16 already rules out handing consumers raw SQL.

  Revisit it if agents need ad-hoc analysis of very large tables, or if column snapshots become how phones query them.
- **Sync engines would compete with Hypercore** rather than sit under the plain text: LiveStore, PowerSync, Zero, Electric, Evolu, Jazz, RxDB, Ditto, sqlite-sync, and the CRDT libraries. "Diffle" was most likely Riffle, LiveStore's research predecessor.
- **To watch:** Turso's Rust rewrite of SQLite (pre-1.0), and HyperDB (Holepunch-native, with indexes but no SQL).

## Compression and splitting rows

Whole-file codecs at 1M rows (442 MB):

| Codec | Size | Ratio (harder data) | Decompress + parse in Node |
|---|---|---|---|
| raw | 442 MB | 1.0 | 1.1 s |
| gzip -6 | 67 MB | 6.6 (3.8) | 1.6 s |
| zstd -3 | 83 MB | 5.4 (4.2) | 1.4 s |
| zstd -19 | 51 MB | 8.7 (5.8) | 1.4 s |
| brotli -9 | 63 MB | 7.0 (5.1) | 1.5 s |

**Reading part of a table without decompressing the rest** (1M rows in 100 shards):

| Layout | Size | Read one shard |
|---|---|---|
| plain NDJSON shards + index | 442 MB | 11 ms |
| zip, one deflate entry per shard | 68 MB | 14 ms, reading 0.76 MB |
| seekable zstd | 83 MB | 15 ms |
| BGZF | 74 MB | 17 ms |

- **The existing archive already reads shards directly.** A zip with one deflate entry per shard is 68 MB for 1M rows, and the fflate reader (SPEC section 13, D28) already parses the central directory.
- **zstd has limits on our platforms.** No browser decodes it natively, it's experimental in Node, and React Native needs a native module or slow pure JS.

**Git already compresses.** Git zlib-deflates every object, so a plain file's pack is the size of gzip -6.

- **Plain NDJSON edits are cheap.** An edit pushes about 0.5 to 2 KB and shows as a one-line diff.
- **Compressed files are expensive to edit.** They show as binary, and every edit costs 25 to 300 KB with zstd, or the whole file with gzip.
- **Plain shards can pack worse than one file** under default `git gc`, because of how git picks deltas.

The options, in short:

- **(a)** plain shards on disk and in git, compressed only in the single-file form;
- **(b)** compressed shards as the stored form;
- **(c)** a derived columnar copy (Parquet at 72 MB).

(a) keeps plain text, diffs and cheap edits. (b) and (c) give those up.

## Sheet view grids (D41)

A Sheet view numbers its rows by its saved grouping, order or sort, and formulas read by place in that grid: "the row above" for a running total, or a range. Measured with the reference code, `packages/core/src/grid.bench.ts`, on the same machine (29 Sep 2026). The data is a shuffled ledger sorted by a text date; the running total is `(sum (at "balance" -1 "by-date") amount)`.

| Rows | Sort and number the grid | Running balance down it (grid included) |
|---|---|---|
| 10k | 7 ms | 20 ms |
| 50k | 29 ms | 60 ms |
| 1M | 0.79 s | 1.26 s |

- **Sorting is most of the grid's cost.** Each row's sort key is worked out once, and a single sort over plain text or numbers compares natively; comparing text with a function on every comparison took 5.2 s at 1M rows.
- **Reading a place is an array read.** Computed values, grid order and each row's position are arrays indexed by the row's place in the file, so a running total does no map lookups.
- **A long chain doesn't overflow the stack.** A chain of places deeper than 400 formulas is worked out down its grid instead of by recursion, tested at 100k rows.
- **Memory at 1M rows** (peak resident size, `/usr/bin/time -l`): the rows alone take 244 MB. Building the grid peaks at about 300 MB and keeps 8 MB once built (its order and each row's place). The running balance peaks at about 400 MB and keeps 96 MB, most of it the rows copied with their computed fields, which `computeRows` returns.
- **Reading one cell by offset** (the running total's case) skips building a description of the place, about 12% faster at 1M rows.
- **Where the next gain is:** every change recomputes the table from scratch, grid included. Keeping grids and results between edits, and redoing only what an edit touches, would make an edit to a 1M-row table cost milliseconds rather than a second. Not measured on phones yet.

## Sync

Workspace today downloads and decrypts the whole data log on every change (`packages/workspace/src/index.ts:1733`, workspace repo). Only blobs are on demand. Holepunch is sparse by design: Hypercore fetches blocks on read, Hyperbee fetches only the path a query touches, and Hyperdrive fetches contents per folder.

Options for a large table:

- **A.** Row edits in the data log: the least new machinery, but every device gets every edit.
- **B.** Rows in a Hyperbee keyed by row id: sparse reads and small edits. It's single-writer without Autobase.
- **C.** A core per table, fetched on open: devices that never open it download nothing.
- **D.** Rows split into chunks stored as blobs, fetched on demand.

**Being worked on in the workspace repo:**

- **workspace-sh/workspace#610** covers the whole tree on join, contents on open, and placeholders.
- **workspace-sh/workspace#612** is a spike on per-tier Hyperdrives instead of Workspace's own encryption layer. Both are with the Linux rig, and #610 waits on #612.

## In the apps today (2 Oct 2026)

Leslie, 2 Oct: make large tables work on mobile first, then the web; the web demo stays client-side (SQLite through WebAssembly when it comes to that). This is the starting point, measured before any change (Phase 0).

**How:** `scripts/big-table.mts <rows> <dir>` writes a seeded, deal-shaped table (8 fields, one a formula; about 165 bytes a row) as a folder and as a single-file `.table` (in `single-file/`; until D50 it was a `.table.zip`, which the measurements below opened). The apps open the zip as a picked file is opened (`openArchive`), timed in three steps: fetch, read (unzip and parse) and show (render).
- **iOS:** a Release build made with `EXPO_PUBLIC_TABLE_MEASURE=1`, in the iOS 26 Simulator on this Mac. It asks `scripts/measure-server.py` what to open, edits the first row's title once, and posts the times back (`apps/mobile/measure.ts`). The app is reinstalled before each run. Memory is the process's peak resident size.
- **Web:** the Vite development build in Chromium (`__tableWeb.openZipFrom`), with render and commit timed by `flushSync`. Measured before the rule in [BENCHMARKING.md](BENCHMARKING.md) (Release builds only); rerun in a production build before comparing.
- **Data alone:** `scripts/big-table-read.mts` in Node 22, with no drawing: `openArchive`, then `applyView` (formulas, filters, sort) as `derive()` runs it on every render.

| Rows | iOS show | iOS edit | iOS peak memory | Web show | Web page elements | Web heap |
|---|---|---|---|---|---|---|
| 1,000 | 11.4 s | 8.4 s | 1.0 GB | 1.3 s | 25k | 106 MB |
| 5,000 | 103 s | 58 s | 1.6 GB | 5.1 s | 125k | 356 MB |
| 10,000 | killed after 6.5 min, never shown | | 1.9 GB | 15 s | 250k | 790 MB |
| 50,000 and up | not attempted | | | not attempted | | |

On iOS, unzipping and parsing took 0.18 s at 1,000 rows and 0.9 s at 5,000; all the rest is drawing. A web edit at 1,000 rows took 2.2 s.

| Rows | rows/ | Read (unzip, parse) | View (formulas, filter, sort) | Heap |
|---|---|---|---|---|
| 50,000 | 8 MB | 0.13 s | 0.04 s | 47 MB |
| 100,000 | 16 MB | 0.26 s | 0.08 s | 86 MB |
| 1,000,000 | 165 MB | 2.7 s | 0.6 s, again on every render | 700 MB |

**What it says:**
- **Drawing is the wall, by far.** Every row is drawn (twice with a pinned column) inside one long page, and each row has its own native context menu. Below about 100k rows the data side is fast enough even on a phone, whose JavaScript runs several times slower than Node here.
- **An edit redraws everything** and writes every table to storage in one piece, so it costs as much as opening.
- **At a million rows the data itself is the problem:** 700 MB of objects and 0.6 s per render on a Mac. That needs the index (SQLite), not just faster drawing.

**The plan:** Phase 1, draw only the rows on screen. Phase 2, compute and save only what changed. Phase 3, SQLite as the index (the web through WebAssembly). Each phase reruns these tables, and fills in 50k, 100k and 1M as they become possible.

### Phase 2: computing and saving only what changed (#325)

`scripts/big-table-app.mts <zip>` runs the app's own state (`derive` after the reducer) in Node, with no drawing. Milliseconds, before → after:

| Rows | derive, first | derive, same state | derive after an edit | derive after opening a panel |
|---|---|---|---|---|
| 10,000 | 89 | 35 → 0.2 | 27 → 4.6 | 24 → 0.2 |
| 100,000 | 434 | 250 → 0.2 | 249 → 37 | 252 → 0.2 |
| 1,000,000 | 4,100 | 0.2 | 508 | 0.2 |

- **Formulas and validation are kept per row object.** Rows are never changed in place, so an edit makes one new row and the rest are found again. Only formulas that read their own row's fields are kept; a formula that reads across rows, tables or a Sheet view's places is computed whole.
- **`derive` answers again with the same rows** when the table, its bundle's other tables, the view, the arrangement, the search and the locale are the same.
- **The web demo and the phone save 400 ms after the last edit**, not on every key. Every table is still one stored value, written whole (about 1 s to stringify at 1M rows); Phase 3's index replaces that.
- **What's left at a million rows:** an edit still passes over every row (filter, sort, ids) for about half a second, and the first open takes 4 s.

### Drawing only the rows on screen, on the web (W1, 9 Oct 2026)

The web's table draws its rows through LegendList (`packages/ui/src/internal/RowList.web.tsx`), following the page's own scroller. Every height is known before a row is drawn, so nothing is measured. A table's two panes are two lists with the same rows and heights. iOS has since followed (below); macOS and Android still draw every row.

A production build made with `VITE_TABLE_MEASURE=1`, in headless Firefox at 1280 × 800 on the Linux rig (a 2017 MacBook, 8 GB), opening the same `.table.zip` files. "First rows" is from the pick to two frames after the rows are on screen. A jump sets the page's scroll position and waits two frames.

| Rows | Read (unzip, parse) | First rows | Page elements | After scrolling to the end | Jump to the middle | Edit a title |
|---|---|---|---|---|---|---|
| 10,000 | 72 ms | 0.24 s | 1,401 | 1,720 | 101 ms | 72 ms |
| 50,000 | 0.32 s | 0.77 s | 1,401 | 1,720 | 119 ms | 137 ms |
| 100,000 | 0.63 s | 1.44 s | 1,401 | 1,720 | 143 ms | 273 ms |

- **The page no longer grows with the table.** 10,000 rows were 250k elements and 15 s; they are 1,401 elements whatever the row count.
- **What's left is the data.** At 100,000 rows nearly half the time to first rows is unzipping and parsing, and an edit takes 273 ms because the view is worked out again over every row. That is past the 135 ms bar from 50,000 rows up, which is where the index takes over (Phase B).
- **Since then (9 Oct, later), an edit in memory is 52, 60 and 95 ms** at 10,000, 50,000 and 100,000 rows: the table reads its rows by place from one source (`ViewRows`), in memory or in the index, and no longer makes a list of every row's id and top on each draw. First rows are as they were (0.24, 0.78, 1.44 s).
- Arrow keys, and Ctrl with an arrow to the table's first or last row, bring a row into view whether or not it was drawn. Back and Forward put the page back by row: a row's place comes from the heights before it, so it needn't be drawn to be found.

### Building only the rows near the screen, on Linux (L1, 9 Oct 2026)

The GTK table (`packages/gtk/src/TableView.tsx`) builds the rows within 900 px of what's on screen, between two empty boxes as tall as the rows above and below, so its scroller is as long as the whole table. The built stretch moves when scrolling brings the screen within 300 px of its edge. A key that goes to a row that isn't built (Ctrl with an arrow, or an arrow at the edge) scrolls there and gives that row's cell the focus once it's built.

Checked by `apps/linux/tests/large-table.test.tsx` at 3,000 rows. A selected cell scrolled far out of view is dropped with its row, so the table has no cell selected until one is clicked.

### Drawing only the rows on screen, on iOS (I1, 10 Oct 2026)

The phone's table draws the rows near the screen (`packages/ui/src/internal/RowList.native.tsx`): a body as tall as the list, with those rows placed in it by their known heights. It is the web's renderer for a list too tall for a browser (`TallRows`), with the same mapping past `MAX_LIST_HEIGHT`, since a million rows is more points than a 32-bit layout places exactly.

- **The screen's own scroll view stays the scroller**, so the large title, the insets and Back's return to place are as they were. It says where it is scrolled through `PageScrollContext` (`packages/ui/src/pageScroll.ts`), and the table's two panes each draw from that same offset, so they show the same rows.
- **Not LegendList, which the web uses.** Its React Native build draws only what it scrolls itself, and a list inside the screen's scroll view has no height of its own to window by.
- **An app that gives no `PageScrollContext` draws every row**, as before: macOS and Android today.

iPhone 17 Pro Simulator, iOS 26.0, a development (Debug) build, opening the same `.table.zip` files in memory. These times are a Debug build's on a Mac's processor and say only that the tables open; a Release build on a phone is still to be measured.

| Rows | Read (unzip, parse) | Shown | Cells mounted at the top / middle / end |
|---|---|---|---|
| 10,000 | 2.4 s | 0.9 s | 248 / 376 / 304 |
| 50,000 | 12.1 s | 2.6 s | 296 / 376 / 304 |

- **What's mounted no longer grows with the table.** 10,000 rows used to end the app; every row's cells were drawn.
- **What's left is the data**, as on the web: reading is most of the time at 50,000 rows, which is where the index takes over (I2).
- Selecting, editing, Return moving down a row, group headings, totals, a row's grip and Back's return to a row deep in the table work as at 17 rows, checked at 10,000.

### A view read through the index (Phase B, core; 9 Oct 2026)

`queryIndex` answers everything a view asks of its rows (`ViewRows`): a window of rows or of ids, a row by id, a row's place, the view's groups and its totals. Each is what the rows in memory give (`memoryViewRows`), checked over random filters, sorts, groups, totals and searches on both SQLite engines, or `queryIndex` returns null.

`scripts/big-table-index.mts <folder.table> <index.sqlite>` builds the index with `node:sqlite`, streaming the rows, and times each. Node 24 on the Linux rig, milliseconds. The first time a view groups by, sorts by or totals a field, an index for it is made and kept in the file; "after" is every time after that.

| | 100,000 rows | 1,000,000 rows |
|---|---|---|
| Build | 3.2 s | 37 s |
| Open a view (its counts) | 2 | 4 |
| 200 rows from the middle | 4 | 35 |
| A row by id | 0.2 | 0.2 |
| A row's place, file order | 5 | 47 |
| Groups (by stage), first → after | 84 → 8 | 1,019 → 90 |
| 200 rows from the middle, grouped | 2 | 11 |
| The same, sorted by amount | 3 | 12 |
| Totals (a sum, an average, a count), first → after | 161 → 40 | 2,328 → 310 |
| Totals under a filter | 23 | 260 |
| A row's place in a sorted, grouped view | 88 | 940 |
| An edit (`putRows`) | 2 to 4 | 2 to 3 |
| 200 rows again after the edit | 5 | 34 |

- **An edit is a few milliseconds at any size**, against 273 ms at 100,000 rows in memory.
- **The first group, sort or total of a field at a million rows costs a second or two**, once per file. The apps can make those indexes while they build, from the fields the table's views use.
- **A row's place in a sorted view is the slow one** (0.9 s at 1M): every row before it is counted. It is asked only when going to a row by id, not while scrolling.

### What Linux does (L2, 9 Oct 2026)

A table of 50,000 rows or more (`INDEXED_FROM`), opened from a folder, is held in the bundle's `index.sqlite` instead of in memory, as long as its formulas read only their own row and it has no Sheet view.

- **Opening.** Its rows files aren't parsed into memory. A worker (`apps/linux/src/indexWorker.ts`, over `node:sqlite`) hashes the table's files; if the index is missing or was built from other content it builds it, streaming the rows. Meanwhile the table shows its rows as the file has them, in the view's columns, under a count of rows read and a progress bar: the first 200 at once (`firstRows`), and every row read so far to scroll through, read from the index as it is built (`IndexHost.peek`; the worker's build takes a turn a statement, as the web's does). Nothing in them takes the keyboard, and search waits. When the reading is done the same table takes the view's own rows, where it was scrolled to. A fresh index opens at once. The table is ready when its rows are in: the search's own index, most of a build's time, is made after, a step at a time behind whatever the window asks for (`buildSearchIndex`), and until it is whole a search reads every row's text. At 1,000,000 rows on the rig: counting from 2.3 s, rows in and the table ready at 17.7 s (39 s when the search index was made first), a search 0.7 s until its index is whole about 30 s later, then 22 ms.
- **Reading.** The table view reads a window of rows, its groups and its totals from a `ViewRows` (`indexedViewRows`), 200 rows at a time, and draws an empty row of the right height for one that hasn't arrived. Sorting, filtering, grouping and searching are queries. When the index can't promise an answer, every row is read out and the view is worked out in memory.
- **Editing.** A cell edit, a new row and a deleted row are made in the index and show at once. 400 ms after the last one the rows are written back to its rows files in file order, each row to the file it came from (new rows to the last, a file past about 25 MB split), and the index is stamped fresh for them. The save doesn't hold the worker: each 5,000 rows it reads take a turn, and the search index's steps wait for it. At a million rows it takes 6 s, and a window of rows not read before, asked for half a second into it, is answered in 56 ms; an edit in 37 ms. An edit made meanwhile stops the save, the files left as they were, and the table is saved again after the edit; the index is stamped fresh only by a save no edit came into. The save before a change of fields runs to its end, and edits wait from before it starts until the index has changed.
- **Scrolling.** GTK places widgets with single-precision numbers, so rows more than some millions of pixels down sat a few pixels off. Rows are laid out in a body of at most 8 million pixels, and the scroller's travel is mapped onto the whole table: dragging the bar goes anywhere, and scrolling moves a pixel a pixel.
- **If the index can't be made** (no space, no SQLite), the table is read into memory and a notice says so.

Seen in the built app, dark, at 100,000 and at 1,000,000 rows: the first rows while it builds, the view once built, a jump to the middle and to the last row. The million-row index is about 680 MB beside 165 MB of rows files. A build commits every 20,000 rows, so the write-ahead log beside the index stays small while it runs (38 MB at its largest for a million rows; as one transaction it grew as large as the index).

- **Undo.** An edit to a row is undone in the index, as it was made there: each edit comes back from the index with the one that undoes it (`makeIndexEdits`' `back`), a cell with what it held and a row removed with its place in the file order, and undo queues that (APP-STATE, "Undo"). The web and the phone do the same. On the web at 100,000 rows an undo or a redo shows in about 100 ms.
- **Its fields** (#551). A field's title and choices change nothing in the index. A field added, removed, moved or retyped, or a formula added or changed, changes the index where it is (`alterIndex`): the rows are saved (a removed field's values leave the rows files), the index answers for the new fields at once, and what has to be worked out again (a formula's results, a new or retyped field's columns, the search text) is filled in behind whatever the window asks for (`fillIndex`, 5,000 rows a step). Until it's filled, a view sorted or filtered by those fields, or a search, is worked out in memory, and a formula's values are worked out as rows are read; once it's filled, the view is asked again. On the web, iOS and the Mac the same. Only a table with formulas that read other rows is built again. At 1,000,000 rows on the rig (in place, against 16.3 s to build again, during which nothing answers):

  | Change | Answering again | Filled in behind |
  |---|---|---|
  | A formula added | 14 ms | 11.1 s |
  | A field added | 53 ms | 7.7 s |
  | A field retyped | 36 ms | 8.2 s |
  | A field removed | 14 ms | 10.2 s |

  A field removed is left out of every row read and saved at once, and its values stay in the index, hidden (#556, #562). A change of fields is an undo step, as on a small table: undo changes the index back in place, and a field deleted comes back with its values (the app says which fields an undo restores), written to the rows files again. A new field that only reuses a deleted field's name starts empty.
- **Other layouts.** A board, gallery, list or calendar draws every row it's given, so it gets an indexed table's rows when the view shows 5,000 or fewer (a filter or a search narrows it); above that it says how many there are and what to do.
- **Export.** A single-file `.table` is made in memory, from the rows read out of the index, for a table of up to 250,000 rows; above that it says so, and the folder can be copied as it is.

Not there yet for an indexed table: removing a choice (it has to come out of every row that holds it), checking its rows against the schema (the summary says "not checked"), and an archive of more than 250,000 rows. No timings from the app itself yet; the index's own are above.

### What the web does (W2 and W3, 9 Oct 2026)

A single-file `.table` of 256 KB or more is read in the page's worker (`apps/web/src/sqlite/worker.ts`), where SQLite's WebAssembly build keeps each bundle's index in the browser's own file storage (OPFS). A table of 50,000 rows or more that the index can hold never reaches the page as rows:

- **Opening.** The worker reads the archive's directory and its small files, and inflates only the start of a large table's rows (`LazyZipEntry.head`, several rows files read as one): enough for the first 200 rows and to judge how many there are. The page has those to show in a few hundred milliseconds, whatever the table's size, under a count of rows read and a bar. The rest is inflated a piece at a time, each piece going into the index and into a file kept beside it, which stays the truth. Its CRC is checked at the end; a damaged archive keeps nothing.
- **While it's read**, the table shows every row read so far, in file order, to scroll through and look at: the first 200 are with the page already, and the rest are asked of the worker, which sees the rows its build has put in (`rowsBeingBuilt`, on the build's own connection). The build doesn't hold the worker: each of its statements takes a turn, and before each the worker hears what the page has sent. Anything that would write to that bundle waits for the build. When the reading is done the same table view takes the view's own rows, so where you had scrolled to is where you still are.
- **Reading and editing.** The indexer runs in the worker. The page holds a `ViewRows` whose every answer is one message (`remoteViewRows`), and an edit is one message that comes back with the next snapshot's rows for what's on screen already read (`peek`), so it shows in one draw.
- **Saving.** 400 ms after the last edit the rows are written out of the index to the file beside it: 1.2 s at 100,000 rows, 13 s at a million. Like a build, a save doesn't hold the worker: each 5,000 rows it reads take a turn, so reads and edits are answered between them, and the search index's steps wait for it. An edit made meanwhile stops the save (the file would be out of date as it was finished) and the page saves again after the edit; the file is marked as not whole until a save ends, and the index is stamped as saved only by a save no edit came into. The save before a change of fields runs to its end, and edits wait from before it starts until the index has changed. A save writes the rows whenever the index isn't stamped as saved, whether or not the page knows of edits: after a reload it doesn't, and the index does.
- **After a reload** the table is as it was left: the index and the rows file are still in the browser's storage, and nothing is built again. A rows file cut short (the page closed while it was written) isn't taken for the table. If the browser gave no storage, the index is in memory and a notice says the table goes with the page.
- **One worker for every bundle.** The storage's pool of files belongs to the worker that opens it first; a second one would get memory only. A second tab of the app does: a large table opened in the first says there that it's open in another tab, which holds its storage, and one opened in the second is held in memory with a notice saying why.
- **Leaving the page lets the storage go.** A browser may keep a page it has left, for Back, and its worker with it; the worker is ended as the page is left, so the app loaded afresh in that tab has the storage, and a page brought back by Back loads again. Checked in Firefox and Chrome: an edit, then a reload, another page and the app loaded afresh, and another page and Back all show the table with the edit; a second tab says the table is open in another.
- **A list taller than a browser lays out** (it stops placing things some millions of pixels down; a million rows are 45 million): the rows are placed in a body of at most 8 million pixels and the page's scrolling is mapped onto the whole list (`TallRows` in `RowList.web.tsx`), as the GTK table does.
- **A window deep in file order** is found by position in an index of positions alone, not by skipping to it: skipping passed over every whole row before it, and a jump to the middle of a million rows took from 100 to 700 ms depending on what was cached.
- **The search index** is made after the table is ready, in steps of 5,000 rows, each waiting until the page has asked for nothing for a quarter of a second.

A production build made with `VITE_TABLE_MEASURE=1`, at 1280 × 800 on the Linux rig, each browser headless with an empty profile on disk. Each time is from the pick (or the action) to the result on screen.

| | Firefox 100,000 | Firefox 1,000,000 | Chrome 100,000 | Chrome 1,000,000 |
|---|---|---|---|---|
| First rows | 0.3 s | 0.32 s | 0.28 s | 0.50 s |
| Table ready (sort, filter, edit) | 5.8 s | 61 s | 9.7 s | 85 to 102 s |
| Jump to the middle | 136 ms | 92 ms | 106 ms | 105 ms |
| A search, before its index is whole | 85 ms | 1.1 to 1.6 s | 87 ms | 0.6 to 0.9 s |
| An edit shown | 35 ms | 71 ms | 31 ms | 67 ms |
| A place not read before, asked for while an edit is being saved | 110 to 270 ms | 75 to 125 ms | 65 to 180 ms | 105 to 240 ms |
| Reopened after the browser was restarted | yes | yes | yes | yes |

- **Scrolling into a million rows while they're read:** six seconds in (Chrome; four in Firefox), with 60,000 rows read, a jump to row 40,000 had its rows on screen in 0.5 s (0.35 s), and the page never went longer than 0.28 s without a frame. Row 40,000 was still at the top when the reading finished.
- **A tall list's scrollbar says where you are.** When scrolling rests, the page is put where the rows on screen are in the whole list, with the rows left where they are; so scrolling on never runs out of body short of the table's end. (Two lists side by side share the one move.)
- **First rows no longer wait on the table's size.** Reading the whole archive first, a million rows took 4.4 s to show anything.
- **What it took to get the rest there.** Asked a statement at a time, the worker made an edit take 250 to 470 ms and a jump 1 to 2 s: a dozen messages to open a view, and a list that asked for every page between the top and where it had jumped to (it keeps the items scrolled away, so they can't say what is on screen; the list's own state can). With the indexer in the worker and the list saying what it draws, the worker's part of an edit is 6 ms.
- **At a million rows the wait to be ready is the build**, slower in the browser than in Node (15 s with `node:sqlite`) and slower in Chrome than in Firefox. First rows are on screen for all of it. A search in that time, and until its own index is whole some tens of seconds after, reads every row's text: about a second.
- Linux reads and edits the same way now (`IndexHost.rows`), in its worker.

`Download as a Single File` reads an indexed table's rows out of its index for the archive, up to 250,000 rows; past that it says so and makes none (an archive without a table's rows would look like a copy and not be one). Not there yet on the web for an indexed table: layouts other than Table (it says so), and removing a choice. A table removed leaves its index and rows file in the browser's storage. Safari is not measured.

### What iOS does (I2, 10 Oct 2026)

The phone has a real file system and its own SQLite (expo-sqlite, through core's `expoDriver`), so it does what the web does with a folder in place of the browser's storage and no worker: expo-sqlite runs each statement on its own queue. `apps/mobile/indexHost.ts` is the counterpart of the web's worker and its client; `apps/mobile/useIndexedTables.ts` is the web's hook over it.

- **Where it lives.** A bundle with a table of 50,000 rows or more becomes a `.table` folder in the app's own documents when its single file is opened: `index.sqlite` at its root, the large table's rows in one file, `tables/<name>/rows/0001.ndjson` (the folder is the app's own, so git's file sizes don't apply), and the rest of the bundle's files written by core's writer. A bundle with no large table is held as before, in memory and the phone's key-value store.
- **Opening** is the web's: the large table's rows stay compressed, their head gives the first 200 rows and a judged count, and the rest is inflated a piece at a time into the index and into the rows file. While it's read, every row read so far can be scrolled through.
- **Reading and editing** go through `rowsServer`, `remoteViewRows` and `remoteEdits` in the app's own thread: there is no message to cross, only the turn each request takes.
- **Saving** writes the rows out of the index to a staged file and moves it over `rows/0001.ndjson` in one step. That move is `rename(2)`, from a small native module (`apps/mobile/modules/table-files`): the system's file manager won't move a file onto one that exists, and removing the target first leaves a moment with no file.
- **A save runs beside the screen.** The rows are read on a second connection, in one read transaction, and written while the bundle's own connection goes on answering reads and taking edits. The rules are the web's (#415): an edit landing during a save stops it and nothing is recorded as saved (the index's key must still be the one the file was read at); the rows are written whenever the index isn't marked saved, whatever the screen remembers; the save before an index is made again holds edits from its start and runs to its end. With nothing drawn (`apps/mobile/saveProbe.ts`, from the probe's link `sqlite?save=<a .table.zip's address>`; iPhone 17 Pro Simulator, a development build), reads of 200 rows through the table, one after another:

  | Rows | The save takes | Slowest read during a save, before | After | A read with nothing else going on |
  |---|---|---|---|---|
  | 50,000 | 0.5 s | 421 ms | 39 ms | 3 to 6 ms |
  | 1,000,000 | 9.6 to 10.0 s | 9,600 ms | 84 ms | 12 to 14 ms |

- **Freshness.** The folder is the app's own and nothing else can change its files, so the index's key is the constant `saved`, and what's recorded is that a rows file is whole, and its size (`_kept`): one cut short, by the app being ended as it was written, isn't taken for the table. If these folders are ever shown to other apps (the Files app), freshness will need the files' own content, or their size and date.
- **When no index can be made** (no space, say): while the archive it came in is still held, the table is read from it into memory instead, with a notice. After a relaunch there is nothing to read it from, and the table says its rows are no longer on the phone.
- **Export.** As the web's: `Export as a Single File…` reads an indexed table's rows out of its index for the archive, up to 250,000 rows (`ARCHIVE_ROWS`); past that it says so and shares none.

iPhone 17 Pro Simulator, iOS 26.0, a development (Debug) build. These say that it works; a Release build on a phone is still to be measured.

| | 50,000 rows | 1,000,000 rows |
|---|---|---|
| Read (the archive's directory, small files and the rows' head) | 0.5 s (12.1 s when every row was parsed) | 0.5 s |
| First rows | 1.2 s after | 0.9 s after |
| Table ready (sort, filter, search, edit) | about 12 s, with a count of rows read meanwhile | 7.6 minutes, scrolling through the rows read so far meanwhile |
| Search index whole | | about 2.5 minutes after that |
| An edit | shown at once; in the rows file after the save, with no staged file left | the same; the save rewrites all 165 MB |
| Reopened after the app was ended | within 2 s, with the edit, not read again | 0.6 s, not read again |
| Export `.table.zip` | all 50,000 rows, with the edit: 976 KB | none made; it says a table of up to 250,000 rows can be |
| On the phone | | 822 MB: the rows file 165 MB, `index.sqlite` 665 MB (444 MB before its search index), its log 33 MB |

- **The build commits every 20,000 rows** (`commitEvery`). As one transaction, all of a build sits in SQLite's write-ahead log until its end: at a million rows the log reached 445 MB beside a 444 MB index, and a log keeps its size once written. In steps the log is folded into the index as the build goes and stayed under 38 MB; it is emptied when the build ends, and capped at 16 MB after (`journal_size_limit`). The build took 457 s in steps against 480 s as one transaction.
- **The step's size is not what the screen waits on.** On a phone a build holds React's renders up for seconds whatever `batchSize` or `commitEvery` is, and committing every 20,000 rows costs no time there (11.3 s against 11.4 s at 100,000 rows); the measurements are in the next section. `batchSize` is core's default here for that reason.
- **The driver's mode and yield are the host's settings** (`apps/mobile/indexHost.ts`): async with no yield, as the driver comes, until a phone says otherwise. A build made to measure sets them with `EXPO_PUBLIC_TABLE_INDEX_MODE=sync` and `EXPO_PUBLIC_TABLE_INDEX_YIELD_MS=30`. In sync mode the host builds in batches of 1,000 rows, since there the batch is the longest the screen waits.
- **A development build is slow at a million rows for its own reason.** A search or a sort took about 8 s to show, with the index answering in 5 to 25 ms: the time is React's development-only logging of a component's changed props, which copies the list's million items. It says nothing of a Release build.

Not there yet on iOS for an indexed table: a build that leaves the screen free on a phone (the next section), and any timing of the app itself on one; layouts other than Table (it says so); removing a choice; an archive of more than 250,000 rows; removing a bundle's folder when its file is closed (Reset Demo Data removes them all).

**Two large tables in one bundle.** A build is one transaction on the bundle's one connection, and a read of the bundle's other large table meanwhile may make a sort's or a group's index inside it. If the build then fails, those go with it while core still takes them to exist. Not handled, here or on the web; committing in steps (`commitEvery`) makes it rare.

### iOS: the index over expo-sqlite, on a phone (10 Oct 2026)

expo-sqlite (SDK 55) bundles SQLite 3.50.3 built with FTS5, and everything the indexer asks of it works: the trigram search index with external content, `row_number()`, `json_each`, indexes on expressions, `x is ?` with a bound null, and `page_size` set before the first table. core's `expoDriver` (`packages/core/src/sqlite-expo.ts`) is the `SqlDriver` over it. All 17 indexer cases (`indexer.cases.ts`) pass over it on an iPhone, in both its modes.

**Reading is fast.** iPhone 16 Pro, Release build, 100,000 rows, async mode: one call to SQLite 0.12 ms; opening a view 1.2 ms (12 calls); an edit 2.1 ms (15 calls); a search 16 ms before its search index, 3 ms after; rows read mid-build (`rowsBeingBuilt`) in 40 to 150 ms.

**Building is the problem.** While a table is built, React Native's timers and frames stop for seconds, and so do React's own renders. The probe (below) runs clocks beside the build: a timer, `requestAnimationFrame`, a React render asked for at most every 100 ms, a ping on a second SQLite connection (answered to JS from a background queue), and `Linking.getInitialURL` (answered on the main queue).

| Build (100,000 rows, async, on the phone) | Rows in | Longest timer gap | Longest React render wait |
|---|---|---|---|
| core's defaults (batch 5,000, one transaction) | 10.4 to 11.4 s | 3.2 to 7.4 s | 3.7 s |
| `commitEvery` 20,000, `batchSize` 2,000 | 11.3 s | 8.9 s | 4.4 s |
| the same, and `yieldAfterMs` 100 | 38.4 s | 0.9 s | 0.27 s |
| `yieldAfterMs` 100 (batch 5,000, no `commitEvery`) | 19.6 s | 0.44 s | not measured |
| `yieldAfterMs` 50 | 27.5 s | 0.62 s | not measured |
| sync mode, no yield (the build holds the JS thread) | 7.2 s | the whole build | the whole build |

The JS thread is not blocked (the second-connection ping never waited more than about 250 ms), and nor is the main thread (`Linking`, at most about 125 ms). The commit and the WAL checkpoint are ruled out: with `wal_autocheckpoint = 0` the checkpoint afterwards took 184 ms and the gap was no shorter (7.3 s), spanning dozens of statements. The positions index made before the rows (#395) and committing in steps (#396) don't change the gap either. The iOS 26.5 Simulator on an Apple-silicon Mac shows almost none of it (gaps of 0.3 to 1 s, React at most 0.13 s), so only a phone shows it.

**The likely mechanism.** In React Native 0.83 without the bridge, JS timers are fired by an `RCTDisplayLink` added to the JS thread's own run loop (`ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm`, line 436: `[strongSelf->_displayLink addToRunLoop:[NSRunLoop currentRunLoop]]`, called on the JS thread). While expo-sqlite's results keep arriving, the JS thread runs them back to back and the display link isn't serviced. A `setTimeout(0)` yield is itself held up by this, at about 90 ms each, which is why yielding is so expensive in async mode. This is a reading of the source plus the clocks above, not a proven cause.

**Not measured yet:** sync mode with a yield (`yieldAfterMs` 30 and 50). Nothing is in flight while a sync driver yields, so a yield should cost about a frame rather than 90 ms; if 100,000 rows come in at 9 to 10 s with gaps under about 100 ms, that settles the build with a driver setting. Also not measured: 1,000,000 rows on the phone, and the first sort, group and total indexes at that size.

**What the Simulator adds (iPhone 17 Pro, iOS 26.0, a Debug build, 100,000 rows).** It can't show the stall, but it can say what sync mode with a yield costs in itself:

| Mode | Yield | `batchSize` | Rows in | Longest wait on the JS thread | Rows read mid-build |
|---|---|---|---|---|---|
| async | none | 5,000 | 11.5 s | 0.36 s | 7 reads, slowest 230 ms |
| sync | none | 5,000 | 11.0 s | the whole build | none |
| sync | 30 ms | 5,000 | 11.2 s | 0.35 s | 5 reads, slowest 108 ms |
| sync | 50 ms | 5,000 | 11.2 s | 0.35 s | 5 reads, slowest 100 ms |
| sync | 30 ms | 1,000 | 11.5 s | 0.22 s | 6 reads, slowest 134 ms |
| async | 100 ms | 5,000 | 11.7 s | 0.34 s | 7 reads, slowest 228 ms |

- Sync with a yield builds at async's pace and leaves the JS thread as free as async does.
- In sync mode a yield can only come between statements, so the longest wait is the longest statement: a batch of 5,000 rows (0.35 s here). A smaller batch shortens it, at no cost to the build. A step of the search index is one statement too (0.44 s for 20,000 rows).
- A yield costs nothing here in either mode (async with a 100 ms yield: 2% slower; on the phone, 3.4 times). So the Simulator can't say what a yield costs a phone in sync mode, which is the measurement still wanted.

**If that fails, the build moves off the JS thread.** The preferred route is a react-native-worklets worker runtime running core unchanged, with a `SqlDriver` over a SQLite binding installed into that runtime, calling it synchronously (harmless on a worker thread); the screen reads through `remoteViewRows`, as the web and Linux do. expo-sqlite installs only into React Native's runtime. op-sqlite's C++ entry point, `install(jsi::Runtime &rt, invoker, …)`, takes any runtime, and its `executeSync` and `executeRawSync` don't need React Native's call invoker, so a small native glue file could install it into a worker runtime: untried. Worklets 0.12 supports React Native 0.83; Expo SDK 55 pins 0.7.4. A native build (Swift or Rust reading `rows.ndjson`) would need a second, exact implementation of `encode` and `computeRows`, and is not preferred.

**Running the probe on a phone.** The screen is `apps/mobile/app/sqlite.tsx` (logic in `apps/mobile/sqliteProbe.ts`), in a development build or one made with `EXPO_PUBLIC_TABLE_MEASURE=1`:

```sh
cd apps/mobile
EXPO_PUBLIC_TABLE_MEASURE=1 NODE_PATH=$PWD/node_modules \
  npx expo run:ios --device <UDID> --configuration Release --no-bundler
```

The phone was connected over the local network as a paired device (`xcrun devicectl list devices`). Expo's CLI here is patched never to pass provisioning flags; the log should hold no `-allowProvisioning`. Open the probe with a link; the phone must be unlocked, with the app in front, for the whole run:

```sh
xcrun devicectl device process launch --device <UDID> --terminate-existing \
  --payload-url "sh.workspace.table.mobile://sqlite?rows=100000&modes=async&cases=0&yield=100&batch=2000&commit=20000" \
  sh.workspace.table.mobile
xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
  --domain-identifier sh.workspace.table.mobile --source Documents/sqlite-probe.json --destination probe.json
```

Link parameters: `rows` (comma-separated sizes), `modes` (`async`, `sync`), `cases` (`0` skips the indexer cases), `yield` (`yieldAfterMs`), `batch` (`batchSize`), `commit` (`commitEvery`), `ckpt` (`wal_autocheckpoint` during the build). `probe.json` holds every step as it finishes: `stallsOver250Ms` lists each gap with the statement in flight, and its last entry has the clocks.

### Scrolling on macOS (13 Oct 2026)

Scrolling the 1,000,000-row table on the Mac was far behind iOS. Two faults in how react-native-macos's views meet AppKit were the cause, and both are fixed in `apps/desktop/patches/react-native-macos+0.81.7.patch`. Two faults in how it was first measured hid how much they mattered, and are described after.

**Measured** with the Mac app's scrolling run (`TableScrollBench`, see [BENCHMARKING.md](BENCHMARKING.md)): a Release build, Apple M1 with 8 GB, macOS 27.2 beta, a 1440 × 760 window, 8 columns, the table fully indexed; the page first scrolled 60,000 points down (about 1,300 rows); the app kept awake and nothing attached to it. Two runs of each.

| | Neither fix | Both |
|---|---|---|
| **Slow** (1,440 px in 3 s): the table's place left empty | 0 and 25% | 0% |
| …display refreshes the main thread answered, of 240 | 101 and 118 | 226 and 227 |
| …text drawn | 32,028 times | 66 times |
| **Brisk** (2,400 px/s for 3 s): empty | 28 and 33% | 0% |
| …refreshes answered, of 240 | 110 and 118 | 170 and 174 |
| **One flick** (to 7,200 px/s): empty | 27% | 3% |
| **Eight flicks in a row**: empty | 40 and 41% | 1 to 4% |
| …the main thread's longest gap | 155 and 218 ms | 74 and 120 ms |
| **4 s at 14,400 px/s**: empty | 67% | 78% |

A slow or brisk scroll and a flick now leave the table drawn. A scroll held at 14,400 px/s (320 rows a second) still outruns the rows, before and after: making rows is the limit there, not drawing them, and the main thread stays free meanwhile (a longest gap of 83 ms).

**What is left: a hard flick.** One that starts at 14,400 px/s and falls away over a second and a half (10,149 px in all) shows an empty table for about the first 0.9 s, while it is fastest, and is drawn again by the time it has slowed (27 and 29% of its run empty; four in a row, 36%). The main thread's longest gap is 76 ms throughout: the page moves freely, and the rows arrive once they can be made as fast as they're passed.

**The first fault: every text drawn again at every step of a scroll.** react-native-macos's view class (`RCTUIView`) declares its own `clipsToBounds`, which hides the property AppKit has had since macOS 14. AppKit was never told that a view clips, so it took every view to be able to draw anywhere: a view's visible area was the scroll view's and not its own, and changed with each step (`NSClipView _immediateScrollToPoint` → `NSViewHierarchyInvalidateVisibleRect` → `NS_viewVisibleRectDidChange` → `setNeedsDisplayInRect`). The patch passes `clipsToBounds` on to AppKit, and a text's own view always clips: a clipped view's visible area is its own bounds, which a scroll doesn't change.

**The second: every text's layer visited at every step.** With the text no longer drawn again, its layer was still displayed: AppKit visits the layer of every view that draws in `-drawRect:` whenever its visible area may have changed. Nothing is drawn, but each visit works out the layer's place and scale, for every text in the rows kept drawn above and below the screen too. A text now draws into its layer's contents itself (`-wantsUpdateLayer`), only when asked to: its string, its size, the window's scale or the appearance changed. The drawings are kept, a thousand of them, by what was drawn and not by which view drew it, so a value a table repeats (a stage, an owner, a date) is drawn once.

**What looks different.** Nine views of the fixtures were compared pixel for pixel against a build with neither fix. One thing differs: a link's underline sits one device pixel (half a point) higher. Not checked: the dark appearance, and text with an inline attachment.

**Scrolling on the main thread, or off it.** Since #494 the app's scroll views take AppKit's responsive scrolling. `-scrollOnMainThread YES` on the command line opts out, to compare. With both fixes the run shows no difference: a brisk scroll leaves nothing empty either way, eight flicks leave 3.5% on the main thread against 1 to 4% off it, and the main thread's longest gap is about 70 ms in both. The default is unchanged.

**A trackpad's gesture** (began, changed, ended, momentum) can be sent by the run only for scrolling on the main thread (`-scrollBenchGesture YES`): there it moves the page, and measures as the wheel does (a brisk scroll: nothing empty; eight flicks: 2%). With responsive scrolling AppKit takes a gesture's events from the system's own stream on its own thread, and ignores ones handed to a view or put on the app's queue; events posted to the app from another process arrive at the real pointer's place, not the place they name. That path needs a hand on the trackpad.

#### How the first measurements went wrong

Both of these made the app look far worse than it is, and the second looked like a fault in the app.

- **`sample` attached during the run.** `sample <pid> 1` stops the app a thousand times a second. With it attached, eight flicks never caught up (96 to 99% empty); without it they do. `sample` says where the time goes, in a run of its own; what's felt is measured with nothing attached.
- **App Nap.** The Mac was driven with its screen locked, so the app's window couldn't be seen, and about 25 seconds after each launch macOS napped the app: timers came late and it was given little processor time. A brisk scroll then left 70% of the table empty with the main thread 79% idle and the JavaScript thread 46% idle. It looked like something building up as the page was scrolled (a run after a long scroll started later after launch than one after a jump), and wasn't: the same jump, run 40 seconds after launch and not 17, was as bad, and with the app kept awake both were good. The run now holds an activity (`NSProcessInfo beginActivityWithOptions:`) for as long as it is armed.

#### What was tried next, measured properly (14 Oct 2026)

Each of these was built and measured in the same sitting as the build it is compared with, on the same Mac, two runs or more where a figure decided anything. The same commit measured hours apart differs (eight flicks left 1 to 4% of the table empty one afternoon and 7 to 9% that night), so a figure here is only to be read against the one beside it.

| | As it is (600 points kept drawn) | 1,200 points | 1,200 points and any-slot recycling |
|---|---|---|---|
| Slow scroll: refreshes answered, of 240 | 226 to 228, every run | 227 to 232 in six runs, 152 to 210 in five | 156 |
| Brisk scroll: refreshes answered, of 240 | 168 to 171 | 197 to 199 | 172 |
| One flick: empty | 4.5 to 5.4% | 2.4 to 2.5% | 4.7% |
| Eight flicks: empty | 6.8 to 8.7% | 2.6 to 4.0% | 8.8% |
| A hard flick: empty | 26 to 29% | 19 to 30% | 12 to 26% |
| Four hard flicks: empty | 37 to 38% | 33 to 35% | 30% |
| A hard flick: the main thread's longest gap | 83 to 133 ms | 149 to 183 ms | 142 to 201 ms |

- **More rows kept drawn (1,200 points past the screen, not 600) isn't taken.** It halves what a flick leaves empty, and in about half its runs a slow scroll then ran at 30 frames a second, not 60: most frames came 33 ms apart, with no more mounted or drawn than in the runs at 60. What differs from 600 points is how much is in the scrolled area at all: 3,033 views and 4,565 layers against 2,034 and 3,080. Each step of a scroll costs something for every layer there, and on this Mac half as many again puts a step at the edge of one refresh. A slow scroll is what a table is mostly doing, so it isn't traded for a flick.
- **Any-slot recycling isn't taken.** A row coming on was given the slot of one just gone off (`RowList` today keys a row by its place modulo a number of slots, which reuses a row only when exactly that many are drawn). With 1,200 points it took a little more off repeated hard flicks and gave back what 1,200 points had gained on ordinary ones. It wasn't measured again on its own at 600 points.
- **Rows drawn where the page will be, from its speed, aren't taken.** One flick left 21% empty and eight left 20%, against about 3% without, measured the afternoon before.
- **What this points to is fewer views and layers in a row.** About 37 views and 56 layers are kept for each row drawn (the 27 more rows of 1,200 points are a thousand more views and fifteen hundred more layers). Fewer would cut both what a hard flick waits for (rows to mount) and what every step of every scroll costs, and would make keeping more rows drawn affordable. That is next: a lighter cell where nothing is being edited, column lines drawn once behind the rows, and only the columns in view.

A first JavaScript profile, taken while napped, put about a third of the thread's busy time under React Strict DOM's element (`useNativeProps`, `useStyleProps`); that is still to be taken again.

Ruled out along the way, for a table that scrolls worse after a while: rows on their way from the index (every row drawn was already read), the kept text drawings filling up, views or layers left in the window (their number doesn't change), and the window's Auto Layout engine growing (about 7,300 constraints throughout: every React view has its frame in it as constraints, since the window's split view and SwiftUI panes use Auto Layout, and that is a cost for each view put in or taken out, but a steady one).

#### Sizes far down the table (#518)

Near the end of the 1,000,000-row table, 45 million points down, a selected cell's row handle was drawn differently from row to row: its two 1.5 point bars as one thick bar, as two thick bars, or not at all, and its pill 12 or 16 points high where it should be 14. Nothing was clipped; the sizes were wrong.

Yoga snaps a node to the pixel grid by its place in the whole tree, and sets its size to the difference of its two snapped edges (`roundLayoutResultsToPixelGrid`). Each edge is worked out as a `double` and handed back as a `float`, and past 33,554,432 a float holds only every fourth whole number: so both edges were multiples of 4, and so was every width and height down there. The patch takes the difference before narrowing it. The rows' places were already right (the box they sit in is laid out at a multiple of 4, as `RowList.native.tsx` notes); this is what was left.

- **Nothing changes nearer the top.** For a view less than about 8 million points down, both edges and their difference are exact in a float, so the size is the same number as before.
- **Checked** on five neighbouring rows around row 999,775, in both looks of the handle ("Resize handles": Pills and Grabbers): each is drawn as it is at the top of the table.
- **No cost.** Measured 1,300 rows down as above, with the change and without, two runs each: one flick left 5.7 to 6.2% of the table empty with it and 5.9 to 6.3% without, eight flicks 7.5 to 8.3% and 6.0 to 8.4%.
- **Not on iOS or Android yet.** Yoga's code is the same there (React Native 0.83, and Yoga's main branch), but the iOS app links React Native prebuilt, so a patch to its source isn't compiled in.

## Drawing a million rows: FlashList and LegendList (2 Oct 2026)

Leslie, 2 Oct: compare FlashList v2 (there's no v3 beta) and LegendList for drawing the rows, toward a million. Both only draw the rows on screen; both can handle rows of different heights, which other formats in a table may want soon.

**How** (see [BENCHMARKING.md](BENCHMARKING.md)):
- **Build:** Release, measuring build, iOS 26 Simulator (iPhone 17 Pro) on this Mac; reinstalled before each run.
- **The screen** (`apps/mobile/app/bench.tsx`): N table-shaped rows, each with 8 cells, a coloured choice, money formatted for the locale, and the system row menu (`RowActions`), inside a sideways scroller as the table is. Rows are made from their index, so this measures the list, not the data.
- **The scroll:** three hard flicks through the Simulator's touch injection. Counted from the first scroll event for 3 s: frames, the longest frame, and blank frames (the rows drawn hadn't reached the bottom of the screen). Then a jump to the end, timed until the last row is drawn.
- **Setup:** FlashList 2.3.3 as it comes; it measures rows itself. LegendList 3.6.0 with `estimatedItemSize`, `recycleItems` and `getFixedItemSize` (every row is 44 pt).

| Rows | | FlashList 2.3.3 | LegendList 3.6.0 |
|---|---|---|---|
| 10,000 | open | 93 ms | 77 ms |
| | flicking | 60 fps, longest frame 27 ms | 60 fps, 27 ms |
| | jump to end | 130 ms | 88 ms |
| | peak memory | 337 MB | 345 MB |
| 100,000 | open | 304 ms | 454 ms |
| | flicking | 60 fps, 30 ms | 60 fps, 22 ms |
| | jump to end | 231 ms | 173 ms |
| | peak memory | 340 MB | 359 MB |
| 1,000,000 | open | 2.2 s | 4.0 s |
| | flicking | 60 fps, 33 ms | 60 fps, 25 ms |
| | jump to end | 1.3 s | 2.3 s |
| | peak memory | 411 MB | 499 MB |

No blank frames in any run. The peak includes the app itself, about 300 MB in the Simulator.

**Without `getFixedItemSize`**, measuring every row, LegendList managed 19 fps at 100k rows with a 1.8 s stall, and froze for 3.7 s at 1M. FlashList measures every row and stays at 60 fps. That matters for rows of different heights: LegendList wants each row's height given up front (computed, not measured) to stay fast at this size.

**What it says:**
- Both scroll a million rows at 60 fps with no blanking. Drawing is solved by either; the current table (every row drawn) couldn't show 10,000.
- **Opening** is the difference at scale: both do work for every row up front, FlashList 2.2 s and LegendList 4.0 s at 1M. Both are over the 1 s budget (#126), and on top of the data side (2.7 s to read in Node, more in Hermes), which Phase 3 addresses.
- **The web:** LegendList has a React DOM build that can use an ancestor's scrollbar (`scrollElement`), which suits the web demo. FlashList's web support goes through react-native-web, which the web app doesn't use.
- **Rows of different heights:** FlashList measures them without slowing down. LegendList is fast when it's told each height (`getFixedItemSize` can return a different size for each row), and slow when it has to measure at 100k rows and up.

**Decided (Leslie, 2 Oct 2026): LegendList, on every platform, for now.** One library for iPhone, the Mac and the web (its React DOM build), knowing the caveat: it's fast at a million rows when each row's height is known before drawing, and slow from about 100k rows when it has to measure them.
- Heights that can be worked out keep it fast: a view's row height (the Airtable short to extra-tall kind), group headers, totals, a height stored with a row, and close estimates from a row's text.
- Heights only content can tell (wrapped text, images, page previews) are the risk. Mitigations: cells clip to the view's lines unless a view asks to wrap; estimate then correct for wrapped views; and the table draws through one internal component, so a view that needs measured rows at scale could use FlashList on native later without touching the rest.
- `apps/mobile/app/bench.tsx` stays, so the choice can be re-checked as either library changes.

## SQLite in the browser (Phase 3 spike, 2 Oct 2026)

Can the web demo keep its own index for a big table, with no server? `@sqlite.org/sqlite-wasm` in a Web Worker, the file kept in OPFS through its `opfs-sahpool` VFS (it needs no special headers and runs in Safari, Firefox and Chromium). `scripts/sqlite-wasm/` streams a table's `rows.ndjson` into typed columns (id, title, stage, amount and so on), builds three indexes and an FTS5 index, then times the queries a view needs. A spike: the columns are hardcoded and it isn't the indexer.

**Measured in:** headless Firefox on the rig (8 GB), the table from `scripts/big-table.mts`. Build and reopen are separate page loads.

| Rows | Build once (read and insert, indexes, full-text) | Reopen the saved index, page load to first answer | View, first 50 | Search | Point query | Totals by stage |
|---|---|---|---|---|---|---|
| 10,000 | 0.4 s | not measured | 2 ms | 1 ms | < 1 ms | 4 ms |
| 100,000 | 2.7 s (1.9 + 0.4 + 0.4) | 0.37 s | 2 ms | 1 ms | < 1 ms | 19 ms |
| 1,000,000 | 26.9 s (17.4 + 4.6 + 4.9) | 1.6 s | 2 ms | 1 ms | < 1 ms | 168 ms |

- **Reopening is what a person feels.** After the one build, a 1M-row table is ready in 1.6 s with nothing parsed into JavaScript objects, against 2.7 s to read it in Node and about 4 s to compute its view as the apps do today.
- **Straight after a reopen the cache is cold.** At 1M rows the same queries took: view 6 ms, search 3 ms, point 0.6 ms, totals by stage 350 ms, a page at row 500,000 231 ms, and sorting by an unindexed text field 0.7 s. The sorted-by field needs its index, as the Node findings above say.
- **An edit is a statement, not a rebuild**: updating a row took about 1 ms at every size. That is the in-place update the limits section asks for.
- **The build is the cost** (17 s to insert 1M rows, against 10.9 s in Node): done once per content version, in a worker, with progress. Memory stays flat because rows are inserted as the text is read.
- **Not yet measured:** Chromium and Safari (the VFS is supported in both), the browser's storage quota for a 580 MB index, and a build that follows the table's schema rather than fixed columns.

## The indexer (Phase 3, 2 Oct 2026)

`buildIndex`, `queryIndex`, `putRows` and `removeRows` in `packages/core/src/indexer.ts` are the SQLite index of SPEC section 8, written once against a small `SqlDriver` that each platform fills with its own SQLite (Node's `node:sqlite` is what the tests use; the web passes SQLite WASM in a worker, `apps/web/src/sqlite/`; the phone will pass expo-sqlite). `queryIndex` takes a view's filter, sort and manual order and a search string, and returns a count plus a window reader, `rows(start, end)`. That pair is what a virtualised list draws from.

It is exact or absent. A randomised test compares every answer with `applyView` and `searchRows` (empties, mixed kinds, Unicode, enums, datetimes, arrays, pages, all fourteen filter operators), and anything it can't promise, such as a field holding the wrong kind of value or a formula that reads other rows, returns null so the caller computes the view in memory. Writing it turned up one difference in the in-memory path, fixed with it: an empty cell passed `gt`, `gte`, `lt` and `lte` because JavaScript turns null and "" into 0.

Measured in Node 24 (`node:sqlite`, in memory) on the rig, with the table from `scripts/big-table.mts`:

| Rows | Build (with full-text) | View, first 50 | Search | Page at the middle | Edit one row | First sort of a field | The same sort again |
|---|---|---|---|---|---|---|---|
| 100,000 | 2.4 s | 2 ms | 1 to 13 ms | 2 ms | 1 ms | 90 to 140 ms | under 1 ms |
| 1,000,000 | 31.6 s | 3 ms | 3 to 120 ms | 19 ms | 1 ms | 1.0 to 1.7 s | about 1 ms |

A sort's index is made the first time that sort is asked for, so the first sort of a field costs a second at 1M rows and every one after it is instant, including a page deep into the list. Filters scan: 160 ms for `stage = won` at 1M. These are Node numbers; the browser's are below.

### In the browser (3 Oct 2026)

`apps/web/src/sqlite/` runs the same indexer over SQLite WASM (`@sqlite.org/sqlite-wasm`, 3.53) in a worker, with the database file in OPFS (`opfs-sahpool`, so it survives a reload and needs no special headers). `oo1Driver` in core wraps the WASM database as a `SqlDriver`; the worker owns it and `client.ts` is the `SqlDriver` the page sees, so a build or a query never runs on the thread that draws. The indexer's tests also run over SQLite WASM in Node (`npm run core:test:wasm`), where the FTS5 trigram tokenizer and `json_each` are confirmed present.

`apps/web/harness/` is a page that does a build and the queries in a real browser, from a production build (`BIG_DIR=<dir with big-<n>.table> npm run web:harness:build`, then `npm run web:harness:preview`, and open `/?n=100000`; `fresh=1` drops the stored index first, and a plain reload reopens it). Firefox 155 headless on the rig, `cache_size` 64 MB, 32 KB pages, `synchronous=off`:

| Rows | Build | File | Open (first 50) | `stage = won` | First sort of a field | Page at the middle | Search | Edit | Reopen after a reload |
|---|---|---|---|---|---|---|---|---|---|
| 100,000 | 7.1 s | about 70 MB | 9 ms | 25 ms | 140 to 230 ms | 8 ms | 27 ms | 8 ms | not measured |
| 1,000,000 | 89 s | about 700 MB | 46 ms | 0.8 s | 2.4 to 3.4 s | 30 ms | 0.4 to 0.5 s | 13 ms | 46 ms to the first rows |

The build is about three times Node's (31.6 s at 1M): rows are fetched, parsed and posted to the worker in batches, and OPFS writes cost more than memory. A sort's index is stored in the file, so after a reload the first sort of a field is instant (23 ms at 1M). The 100,000-row run also checks eight queries (filters, enum and text sorts, search, a computed field) against `applyView` and `searchRows`; all match.

What the numbers taught:

- **Page size is the one setting that matters.** At the default 4 KB, 1M rows built in 112 s and `stage = won` took 2.2 s. At 32 KB the build is 89 s and the filter 0.8 s. A scan through OPFS is bound by the number of reads, not bytes, so fewer, larger pages win; a 256 MB cache did not help (it only trimmed search). The page size is set when the file is created and is ignored on an existing file, so changing it needs a new file.
- **A browser must grant the space.** The 1M index is 700 MB, and Firefox's per-site quota is a fraction of free disk: on a profile in a 3.9 GB tmpfs the build failed with `SQLITE_IOERR`. A build that runs out of space rejects with the SQLite error, and the caller should fall back to memory; `WebDatabase.persistent` says only whether OPFS was available at all.
- Filters still scan (0.8 s at 1M, against 160 ms in Node's in-memory database); a first search at 1M is half a second. Phase 1's list should treat a window as arriving late.

## Open questions for the large-tables discussion

- Will people keep `.table` files in git and on GitHub, or mainly in Workspace? D31 says Workspace doesn't sync `.table` through git. The answer decides how much the git findings above matter.
- A shared, sparsely fetched index, so a phone can query a table it has mostly not downloaded. The candidates are HyperDB secondary indexes, SQLite pages replicated over Hypercore (the sql.js-httpvfs pattern), or column snapshots read in byte ranges.
- Shard size: under 1 MB (GitHub's recommended object size) or about 4 MB.
