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

| Rows | `rows.ndjson` | Open | `index.sqlite` | View / search / point query | Whole-table totals | Peak memory |
|---|---|---|---|---|---|---|
| 50k | 22 MB | 0.5 s | 31 MB | < 0.1 ms | about 70 ms | small |
| 100k | 44 MB | 0.9 s | 58 MB | < 0.1 ms | about 160 ms | small |
| 500k | 221 MB | 5.0 s | 293 MB | < 0.1 ms | about 1.2 s | 1.5 GB |
| 1M | 442 MB | 10.9 s | 582 MB | < 0.1 ms | 2.6 s | 2.5 GB |

- **Covering indexes fix totals.** At 1M rows, `(stage, value)` and `(company, stage, value)` took a GROUP BY from 2.5 s to 57 ms and a rollup join from 2.8 s to 176 ms. They cost 2.5 s to build and 53 MB. Such indexes can be derived from the schema and views: relation fields, the fields views filter, sort and group on, and their totals.
- **The open cost is paid once per content version.** The index is keyed by content hash, so reopening an unchanged 1M-row table costs the hash, about 0.3 s.

## Where the limits are

The limits are around SQLite, not in it.

1. **Edits.** SPEC section 8 and D15 rebuild the whole index. That's under 1 s to about 100k rows and 11 s at 1M, so beyond about 200k rows an edit has to update the index in place. That means applying new log entries from a cursor rather than rebuilding.
2. **The file.** A 1M-row `rows.ndjson` is 442 MB. GitHub blocks files over 100 MB, warns above 50 MB, and recommends objects under 1 MB. At 442 bytes a row, that's about 226k rows per file at most, or about 2,260 rows for a 1 MB shard. Very large tables need their rows split across files.
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

- **(a)** plain shards on disk and in git, compressed only in the `.table.zip` archive;
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

**How:** `scripts/big-table.mts <rows> <dir>` writes a seeded, deal-shaped table (8 fields, one a formula; about 165 bytes a row) as a folder and a `.table.zip`. The apps open the zip as a picked file is opened (`openArchive`), timed in three steps: fetch, read (unzip and parse) and show (render).
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

| Rows | rows.ndjson | Read (unzip, parse) | View (formulas, filter, sort) | Heap |
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

- **Opening.** Its `rows.ndjson` isn't parsed into memory. A worker (`apps/linux/src/indexWorker.ts`, over `node:sqlite`) hashes the table's files; if the index is missing or was built from other content it builds it, streaming the rows. Meanwhile the table shows its rows as the file has them, in the view's columns, under a count of rows read and a progress bar: the first 200 at once (`firstRows`), and every row read so far to scroll through, read from the index as it is built (`IndexHost.peek`; the worker's build takes a turn a statement, as the web's does). Nothing in them takes the keyboard, and search waits. When the reading is done the same table takes the view's own rows, where it was scrolled to. A fresh index opens at once. The table is ready when its rows are in: the search's own index, most of a build's time, is made after, a step at a time behind whatever the window asks for (`buildSearchIndex`), and until it is whole a search reads every row's text. At 1,000,000 rows on the rig: counting from 2.3 s, rows in and the table ready at 17.7 s (39 s when the search index was made first), a search 0.7 s until its index is whole about 30 s later, then 22 ms.
- **Reading.** The table view reads a window of rows, its groups and its totals from a `ViewRows` (`indexedViewRows`), 200 rows at a time, and draws an empty row of the right height for one that hasn't arrived. Sorting, filtering, grouping and searching are queries. When the index can't promise an answer, every row is read out and the view is worked out in memory.
- **Editing.** A cell edit, a new row and a deleted row are made in the index and show at once. 400 ms after the last one the rows are written back to `rows.ndjson` in file order, and the index is stamped fresh for them.
- **Scrolling.** GTK places widgets with single-precision numbers, so rows more than some millions of pixels down sat a few pixels off. Rows are laid out in a body of at most 8 million pixels, and the scroller's travel is mapped onto the whole table: dragging the bar goes anywhere, and scrolling moves a pixel a pixel.
- **If the index can't be made** (no space, no SQLite), the table is read into memory and a notice says so.

Seen in the built app, dark, at 100,000 and at 1,000,000 rows: the first rows while it builds, the view once built, a jump to the middle and to the last row. The million-row index is 667 MB beside a 165 MB `rows.ndjson`.

- **Its fields.** A field's title, choices and place change in place. A field added or removed, or a formula changed, makes the index again from the saved rows (a removed field's values leave `rows.ndjson` first); the first rows show meanwhile, and edits made then wait for it.
- **Other layouts.** A board, gallery, list or calendar draws every row it's given, so it gets an indexed table's rows when the view shows 5,000 or fewer (a filter or a search narrows it); above that it says how many there are and what to do.
- **Export.** A `.table.zip` is made in memory, from the rows read out of the index, for a table of up to 250,000 rows; above that it says so, and the folder can be copied as it is.

Not there yet for an indexed table: removing a choice (it has to come out of every row that holds it), checking its rows against the schema (the summary says "not checked"), and an archive of more than 250,000 rows. No timings from the app itself yet; the index's own are above.

### What the web does (W2 and W3, 9 Oct 2026)

A `.table.zip` of 256 KB or more is read in the page's worker (`apps/web/src/sqlite/worker.ts`), where SQLite's WebAssembly build keeps each bundle's index in the browser's own file storage (OPFS). A table of 50,000 rows or more that the index can hold never reaches the page as rows:

- **Opening.** The worker reads the archive's directory and its small files, and inflates only the start of a large table's `rows.ndjson` (`LazyZipEntry.head`): enough for the first 200 rows and to judge how many there are. The page has those to show in a few hundred milliseconds, whatever the table's size, under a count of rows read and a bar. The rest is inflated a piece at a time, each piece going into the index and into a file kept beside it, which stays the truth. Its CRC is checked at the end; a damaged archive keeps nothing.
- **While it's read**, the table shows every row read so far, in file order, to scroll through and look at: the first 200 are with the page already, and the rest are asked of the worker, which sees the rows its build has put in (`rowsBeingBuilt`, on the build's own connection). The build doesn't hold the worker: each of its statements takes a turn, and before each the worker hears what the page has sent. Anything that would write to that bundle waits for the build. When the reading is done the same table view takes the view's own rows, so where you had scrolled to is where you still are.
- **Reading and editing.** The indexer runs in the worker. The page holds a `ViewRows` whose every answer is one message (`remoteViewRows`), and an edit is one message that comes back with the next snapshot's rows for what's on screen already read (`peek`), so it shows in one draw.
- **After a reload** the table is as it was left: the index and the rows file are still in the browser's storage, and nothing is built again. A rows file cut short (the page closed while it was written) isn't taken for the table. If the browser gave no storage, the index is in memory and a notice says the table goes with the page.
- **One worker for every bundle.** The storage's pool of files belongs to the worker that opens it first; a second one would get memory only. (A second tab of the app does.)
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
| Reopened after the browser was restarted | yes | yes | yes | yes |

- **Scrolling into a million rows while they're read:** six seconds in (Chrome; four in Firefox), with 60,000 rows read, a jump to row 40,000 had its rows on screen in 0.5 s (0.35 s), and the page never went longer than 0.28 s without a frame. Row 40,000 was still at the top when the reading finished.
- **A tall list's scrollbar says where you are.** When scrolling rests, the page is put where the rows on screen are in the whole list, with the rows left where they are; so scrolling on never runs out of body short of the table's end. (Two lists side by side share the one move.)
- **First rows no longer wait on the table's size.** Reading the whole archive first, a million rows took 4.4 s to show anything.
- **What it took to get the rest there.** Asked a statement at a time, the worker made an edit take 250 to 470 ms and a jump 1 to 2 s: a dozen messages to open a view, and a list that asked for every page between the top and where it had jumped to (it keeps the items scrolled away, so they can't say what is on screen; the list's own state can). With the indexer in the worker and the list saying what it draws, the worker's part of an edit is 6 ms.
- **At a million rows the wait to be ready is the build**, slower in the browser than in Node (15 s with `node:sqlite`) and slower in Chrome than in Firefox. First rows are on screen for all of it. A search in that time, and until its own index is whole some tens of seconds after, reads every row's text: about a second.
- Linux reads and edits the same way now (`IndexHost.rows`), in its worker.

Not there yet on the web for an indexed table: layouts other than Table (it says so), removing a choice or a field, and `Download .table.zip`. A table removed leaves its index and rows file in the browser's storage. Safari is not measured.

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
