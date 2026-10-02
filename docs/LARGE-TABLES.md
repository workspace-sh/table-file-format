# Large tables

Research notes, not spec. This looks at what happens to a `.table` at 50k to 1M rows: opening it, querying it, storing it, and syncing it. It was gathered on 26 Sep 2026 so a later discussion can start from measurements rather than guesses. Nothing here changes SPEC or DECISIONS on its own.

Companion docs: SPEC section 8 (the `index.sqlite` contract), DECISIONS D6, D15 and D16, [STORAGE-AND-SYNC.md](STORAGE-AND-SYNC.md).

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

## Open questions for the large-tables discussion

- Will people keep `.table` files in git and on GitHub, or mainly in Workspace? D31 says Workspace doesn't sync `.table` through git. The answer decides how much the git findings above matter.
- A shared, sparsely fetched index, so a phone can query a table it has mostly not downloaded. The candidates are HyperDB secondary indexes, SQLite pages replicated over Hypercore (the sql.js-httpvfs pattern), or column snapshots read in byte ranges.
- Shard size: under 1 MB (GitHub's recommended object size) or about 4 MB.
