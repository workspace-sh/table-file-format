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

## Open questions for the large-tables discussion

- Will people keep `.table` files in git and on GitHub, or mainly in Workspace? D31 says Workspace doesn't sync `.table` through git. The answer decides how much the git findings above matter.
- A shared, sparsely fetched index, so a phone can query a table it has mostly not downloaded. The candidates are HyperDB secondary indexes, SQLite pages replicated over Hypercore (the sql.js-httpvfs pattern), or column snapshots read in byte ranges.
- Shard size: under 1 MB (GitHub's recommended object size) or about 4 MB.
