# Large tables: the plan

A plan, not spec. It says how table views on the web, Linux and iOS come to read through the SQLite index, and how the edit history (D44) is written. The measurements it rests on are in [LARGE-TABLES.md](LARGE-TABLES.md); how to measure is in [BENCHMARKING.md](BENCHMARKING.md). Written 8 Oct 2026 for review. Nothing here changes SPEC or DECISIONS until a phase lands.

The bar is #126: 10,000 to 1,000,000 rows within 1 s, and ideally within 135 ms.

## Where things stand

| Piece | State |
|---|---|
| The indexer (`buildIndex`, `queryIndex`, `putRows`, `removeRows`), over a `SqlDriver` | In core (#330). Exact or absent: it answers what `applyView` and `searchRows` would, or returns null. |
| `RowSource` (`count`, `rows(start, end)`) | In core. `arraySource` wraps rows in memory. Nothing draws from one yet. |
| SQLite in the browser, in a worker, kept in OPFS | In `apps/web/src/sqlite/` (#331). Used by `apps/web/harness` only. |
| A list that draws only the rows on screen | Chosen (LegendList, 2 Oct), used only in `apps/mobile/app/bench.tsx`. Every view still draws every row. |
| A `SqlDriver` for Linux or iOS | None. |
| `history.ndjson` (SPEC section 14, D44) | Specified (#313). No code reads or writes it. |

What a person feels today: about 10,000 rows took 15 s to show on the web, and never showed on the phone.

## What the views need from their rows

`ViewProps.rows` is an array, and the table views lean on having all of it. Reading `TableView` in `packages/ui/src/views.tsx` and `packages/gtk/src/TableView.tsx`, the uses are:

| Use | Today | Needs |
|---|---|---|
| Draw the rows | `displayed.map(...)` over every row | A window of rows |
| Row numbers, keyboard movement, range selection | `rowIds`, an array of every id, and `indexOf` | A place for an id, and ids for a range of places |
| The selected row, the open formula's row | `rows.find(by id)` | One row by id |
| Totals | `totalFor(rows, field, kind)` | An aggregate over the whole view |
| Grouping | `groupedRows(view, rows, schema)` | Where each group starts and how many rows it has |
| "3 of 12 matching" | `rows.length` and `inView` | Two counts |
| Row heights (#333) | `rowHeightOf(view, id)` for every row | Heights without loading every row |

## 1. The contract: `ViewRows`

One interface that every view reads, whether the rows are in memory or in the index. It extends `RowSource`, which stays as it is.

```ts
interface ViewRows extends RowSource {
  /** Rows the view shows before the viewer's search. */
  readonly inView: number;
  /** Changes whenever the answer could: a new source after an edit, filter, sort or search. */
  readonly version: string;
  rows(start: number, end: number): Row[] | Promise<Row[]>;
  /** Ids for a range of places, without the rows. */
  ids(start: number, end: number): string[] | Promise<string[]>;
  /** The place of a row, or -1 when the view doesn't show it. */
  placeOf(id: string): number | Promise<number>;
  row(id: string): Row | undefined | Promise<Row | undefined>;
  totals(wanted: Record<string, TotalKind>): Totals | Promise<Totals>;
  /** When the view groups: each group's value, first place and row count, in order. */
  groups(): Group[] | Promise<Group[]>;
}
```

Rules:

- **A source is a snapshot.** That is already `RowSource`'s rule. An edit, filter, sort or search gives a new one with a new `version`. A view never mixes windows from two versions.
- **Keys are row ids.** A row keeps its id and identity across snapshots, so a list keeps its drawn rows when a new source arrives and only the changed rows redraw.
- **A window may arrive late.** The memory source answers at once. The index answers in a few milliseconds to a second (LARGE-TABLES: a page at the middle of 1M rows took 30 ms in the browser, a first filter 0.8 s). A list draws a placeholder row of the known height until the window comes, never blocks a scroll on it, and drops an answer whose `version` is no longer current.
- **Windows are cached by page.** Fixed pages (200 rows is the starting size, to be measured), a small cache of recent pages, one request per page however many times it is asked for.
- **Exact or absent carries through.** `totals`, `groups` and `placeOf` over the index must give what `totalFor`, `groupedRows` and the array would, checked by the same randomised comparison the indexer already has. Where the index can't promise that, the source is the memory one.

The memory source implements all of it over the array (`arraySource` grows into it). The indexed source needs three additions to the indexer in core: aggregates for `totals`, group counts for `groups`, and `placeOf`. Covering indexes for the fields views total and group on are derived from the views, as LARGE-TABLES found (a GROUP BY at 1M rows fell from 2.5 s to 57 ms).

**How sort, filter and search map to queries.** They already do: `IndexQuery` takes the view's `filter`, `sort` and manual `order` and the search string, and `showView` in `packages/app` is the one place that turns a view, an arrangement and a search into rows. `showView` gains a sibling that returns a `ViewRows`: it asks `queryIndex` when the table is indexed and falls back to `applyView` and `searchRows` when the answer is null.

**How an edit writes through.** One path, in `packages/app` beside `edits.ts`, so every platform does the same:

1. Change the row in the current snapshot's cache, so the cell shows the new value at once.
2. `putRows` or `removeRows` on the index (about 1 ms in Node, 13 ms in the browser at 1M rows).
3. Record the edit-history event (section 5).
4. Make the new snapshot: counts again, and the windows on screen again. A row whose new value moves it under the view's sort or out of its filter moves at once, as it does in memory today.
5. Save the table's files, as now, 400 ms after the last edit (section 4).

Schemas with formulas that read other rows refuse in-place edits (SPEC section 8), so those tables stay on the memory path. So do Sheet views (D41), whose formulas read by place. Both are out of scope here and bounded by what Phase 2 measured.

## 2. Two ways to hold a table

- **In memory**, as today: the rows are objects in the app's state, and the source is the memory one. Windowed drawing alone fixes this up to roughly 100,000 rows (LARGE-TABLES, Phase 2: an edit recomputes in 37 ms at 100,000 rows).
- **Indexed:** the app's state holds the schema, views and counts, and the rows stay in the index. This is what a million rows needs (700 MB of objects otherwise).

Which one a table gets is decided when it opens, by row count. The starting threshold is 50,000 rows, to be set by the Phase B measurements. A table can always be held in memory instead: that is the fallback.

## 3. When there is no index

In order, the first that works:

1. **A saved, fresh index:** use it (reopening 1M rows took 46 ms to the first rows in the browser).
2. **No index, or a stale one, and space to build it:** build it in the background. The build streams, so memory stays flat. It takes 7 s at 100,000 rows and 89 s at 1M in the browser.
3. **No space** (a browser that won't grant the quota, a full disk), or no SQLite at all: hold the table in memory and say so. A build that fails with a SQLite error falls to this.

Two things a person sees here are product decisions, listed at the end: what shows while the first build runs, and what the app says when it works without an index.

## 4. Where an edit is saved

`rows.ndjson` stays the truth (SPEC section 8: the index is a cache, and deleting it must be safe). Today each app writes the whole table 400 ms after the last edit. For an indexed table the same save streams the rows out of the index in file order, off the thread that draws, and then sets the index's key to the hash of what it wrote, so the index stays fresh.

- **Linux and iOS:** the bundle's folder on disk, with `index.sqlite` at its root as SPEC section 8 says.
- **Web:** the demo's small tables stay in the browser store as now. An indexed table's `rows.ndjson` is kept as a file in OPFS beside its index, written by the worker.

This is the simplest thing that keeps the spec as it is. Its cost is one full write per burst of edits: at 1M rows that is a 165 MB file. It is measured in Phase B. If it is too slow, the next step is a decision of its own (an append-only journal, or rows split across files, which LARGE-TABLES already raises for git).

## 5. Edit history (D44)

SPEC section 14 fixes the file and its events. What is left is who writes them and when.

- **Where events are made:** the functions in `packages/app/src/edits.ts` (`withCell`, `withRow`, `withRowAt`, `withoutRow`, `withBody`) are already the one funnel for edits. Each returns the events for what it changed, built by a small module in core that also parses and serialises the file.
- **Naming:** `packages/app/src/history.ts` is navigation history (Back and Forward). The edit history lives in separately named modules: `edit-log.ts` in core and `editLog.ts` in app.
- **When they are written:** appended to `tables/{name}/history.ndjson` in the same save as the rows. A page's burst of typing is one `page` event (the editor closed, or about 60 s idle), as the spec asks.
- **`by`:** the app supplies it. Left out when the app has no name for the viewer.
- **Archives:** `.table.zip` carries the file, since it is part of the table.
- **Large tables:** the same events. An append costs the same at any row count.
- **Not in this plan:** a screen that shows or restores history, compaction, and schema or view events. D44 leaves those open.

## 6. Each platform

### Web (the Linux rig implements)

- **W1.** The table draws through one windowed list in `packages/ui`: LegendList's React DOM build inside one internal component (the 2 Oct decision), reading a `ViewRows`. Memory source only. Heights come from `rowHeightOf`; the few rows with a stored height are found by `placeOf`, so no row is measured.
- **W2.** `ViewRows` over the index: the three indexer additions, the `showView` sibling, and the write-through path. The app opens the worker database that already exists.
- **W3.** Building, falling back, and the OPFS save.
- **W4.** Edit history written.

### Linux (the Linux rig implements)

- **L1.** The GTK table draws only the rows in view. It is plain boxes in a `GtkScrolledWindow`, not a `GtkColumnView`, so this is a window of row boxes between two spacers sized from the row heights, moved as the scroll position changes. How is the implementer's call.
- **L2.** A `SqlDriver` over `node:sqlite`, which is built into Node and needs no native addon. It is synchronous, and a filter over 1M rows scans for most of a second, so it belongs off the UI's thread, behind the same message shape as the web worker. GTKX bundles a worker written as `new Worker(new URL("./x.ts", import.meta.url))` into the app (its `worker` build plugin), so the Linux worker can be written as the web one is.
- **L3 and L4.** As W3 and W4, with real files.

### iOS (unowned: Leslie assigns)

- **I1.** The shared list from W1 on the phone (LegendList native; `apps/mobile/app/bench.tsx` already measures it).
- **I2.** A `SqlDriver` over expo-sqlite. To check before starting: that its SQLite has FTS5 with the trigram tokenizer and `json_each`, by running the indexer's tests through the driver on a device.
- **I3 and I4.** As W3 and W4.

The Mac app follows the shared list and needs its own driver; it is not in this plan.

## 7. Fitting around the parity work

The feature-parity work in progress (small PRs, #357 to #362 merged so far) changes editing and selection in `TableView`, not how rows are read.

- **`TableView` keeps handing cells what it does now:** a row object and its id. Windowing wraps the loop over rows; it doesn't change a cell.
- **Selection is kept as ids and places**, never as an array of every id, so a range can cross windows that haven't loaded.
- **Restoring a place** (the parity work's Back and Forward with scroll, selection and open page): a scroll position is saved as the id of the top row and how far into it, with its place beside it. Restoring asks `placeOf(id)` and scrolls there. If the row is gone, the saved place is used. A pixel offset alone doesn't survive a table that is windowed.
- **No changes to `packages/core` come from the parity work**, so the indexer additions don't collide.

## 8. Measuring

Release builds only. Data from `scripts/big-table.mts` at 10,000, 50,000, 100,000 and 1,000,000 rows. Clean state before each run.

| Where | Build |
|---|---|
| Web | `web:build` then `web:preview`, in Firefox on the rig (the existing numbers), then Chromium and Safari, which are not yet measured |
| Linux | The GTK app on the rig |
| iOS | Release in the Simulator, said to be optimistic; Leslie's iPhone 16 Pro is the reference and is Leslie's to run |

Each run reports: open to the first rows (first build, and reopening), flicking (frames, the longest frame, and how long a window stayed a placeholder), a jump to the end, an edit until it shows and until it is saved, a filter, a first sort and the same sort again, a search, totals, peak memory, and the index's size against the quota.

## 9. Phases and what each must show

Proposed numbers, for review. They come from what LARGE-TABLES measured, with the budget as the ceiling.

| Phase | Covers | Must show |
|---|---|---|
| **A. Draw only what's on screen** (W1, L1, I1) | Memory source, every platform | 10,000 rows: first rows within 1 s (web was 15 s). 100,000 rows: first rows within 1.5 s. Flicking at 60 fps with no blank rows. An edit shows within 135 ms. Page elements don't grow with the row count. |
| **B. Read through the index** (W2, L2, I2) | Indexed source, exact against memory | 1M rows: reopen to first rows within 135 ms. Any window within 135 ms. An edit shows within 135 ms. A filter, a search and totals each within 1 s. The same sort again within 135 ms. Every answer equal to the memory path's. |
| **C. Build, fall back, save** (W3, L3, I3) | First open, no space, files | 1M rows: something on screen within 1 s of opening, with progress. With no space, the table opens in memory and says so. A save after an edit, timed, off the drawing thread. Deleting the index loses nothing. |
| **D. Edit history** (W4, L4, I4) | D44 | Every edit made in the app appears as one event. A table round-trips through `.table.zip` with its history. A reader without history support leaves the file alone. |

Two known gaps against the bar, with what closes them:

- **A first sort of a field at 1M rows** took 2.4 to 3.4 s in the browser, because the sort's index is made then. Building the indexes for each view's saved sorts during the build removes it for those sorts (afterwards 23 ms).
- **The first build** is 89 s at 1M rows in the browser. It is paid once per content version. Phase C's first-second requirement is about what shows meanwhile, not about finishing.

## 10. Decisions wanted

For Leslie:

1. **While a large table's index is first being built:** show its rows in file order straight away, with sorting, filtering and search waiting on the index (proposed), or show progress until everything works.
2. **When the browser or disk won't give the space:** open in memory with a notice (proposed), or decline to open tables above some size.
3. **Who does iOS** (I1 to I4).

For review by whoever implements web and Linux (accepted by the Linux rig, 8 Oct 2026):

4. The `ViewRows` shape in section 1. Accepted; it may gain or lose a method once W1 has a real list reading it, and any change is recorded here.
5. The 50,000-row threshold and the 200-row page, both starting points for measurement. Accepted as starting points.
6. Saving by rewriting `rows.ndjson` (section 4) until Phase B's numbers say otherwise. Accepted.
