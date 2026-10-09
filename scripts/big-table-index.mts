// A view read through the index, without drawing it (#363): build a
// big-<rows>.table folder's index with node:sqlite, streaming its rows, then
// time what a view asks of a ViewRows.
//
//   npx tsx scripts/big-table-index.mts <folder.table> <index.sqlite>

import { createReadStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { buildIndex, putRows, queryIndex, type IndexQuery, type SqlDriver } from "../packages/core/src/indexer.ts";
import type { Row, TableSchema } from "../packages/core/src/types.ts";

const [folder, file] = process.argv.slice(2) as [string, string];
const dir = join(folder, "tables", "deals");
const schema = JSON.parse(await readFile(join(dir, "schema.json"), "utf8")) as TableSchema;
await rm(file, { force: true });
const db = new DatabaseSync(file);
db.exec("pragma page_size = 32768; pragma journal_mode = wal; pragma synchronous = normal;");
const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
const prepared = (sql: string) => cache.get(sql) ?? (cache.set(sql, db.prepare(sql)), cache.get(sql)!);
const driver: SqlDriver = {
  exec: async (sql) => db.exec(sql),
  run: async (sql, params = []) => void prepared(sql).run(...params),
  all: async (sql, params = []) => prepared(sql).all(...params) as never,
};

async function* rows(): AsyncIterable<Row> {
  for await (const line of createInterface({ input: createReadStream(join(dir, "rows.ndjson")) })) if (line) yield JSON.parse(line) as Row;
}
const ms = async <T,>(run: () => Promise<T>): Promise<[number, T]> => {
  const t = performance.now();
  const out = await run();
  return [Math.round((performance.now() - t) * 10) / 10, out];
};

const out: Record<string, unknown> = {};
[out.buildMs] = await ms(() => buildIndex(driver, { name: "deals", schema, rows: rows(), key: "k" }));
const open = (query: IndexQuery) => queryIndex(driver, { name: "deals", schema, query });

const [plainMs, plain] = await ms(async () => (await open({}))!);
out.rows = plain.count;
out.openMs = plainMs;
const middle = Math.floor(plain.count / 2);
[out.pageMiddleMs] = await ms(() => plain.rows(middle, middle + 200));
const [, ids] = await ms(() => plain.ids(middle, middle + 1));
[out.placeOfMs] = await ms(() => plain.placeOf(ids[0]!));
[out.rowMs] = await ms(() => plain.row(ids[0]!));

// Twice: the first time a view groups, sorts or totals a field, the index
// for it is made and kept in the file; after that it is only read.
for (const pass of ["first", "again"]) {
  const t: Record<string, unknown> = {};
  const grouped = (await open({ group: "stage", totals: { amount: "sum", probability: "average", owner: "count" } }))!;
  [t.groupsMs] = await ms(() => grouped.groups());
  [t.groupedPageMiddleMs] = await ms(() => grouped.rows(middle, middle + 200));
  [t.totalsMs] = await ms(() => grouped.totals());
  [t.groupedPlaceOfMs] = await ms(() => grouped.placeOf(ids[0]!));
  const sorted = (await open({ sort: [{ field: "amount", direction: "desc" }], group: "stage" }))!;
  [t.sortedGroupsMs] = await ms(() => sorted.groups());
  [t.sortedGroupedPageMs] = await ms(() => sorted.rows(middle, middle + 200));
  [t.sortedPlaceOfMs] = await ms(() => sorted.placeOf(ids[0]!));
  const filtered = (await open({ filter: [{ field: "stage", operator: "eq", value: "won" }], totals: { amount: "sum" } }))!;
  [t.filteredPageMs] = await ms(() => filtered.rows(0, 200));
  [t.filteredTotalsMs] = await ms(() => filtered.totals());
  out[pass] = t;
}

const row = (await plain.row(ids[0]!))!;
[out.editMs] = await ms(() => putRows(driver, { name: "deals", schema, rows: [{ ...row, title: "Edited" }], key: "k2" }));
[out.reopenAfterEditMs] = await ms(async () => (await (await open({}))!.rows(middle, middle + 200)).length);
console.log(JSON.stringify(out));
