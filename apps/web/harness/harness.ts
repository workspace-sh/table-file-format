// Runs the SQLite index in a real browser, against a big table served beside
// it, and reports build time, query times and (for tables of 100k or fewer)
// that every query answers what applyView and searchRows answer.
//
//   BIG_DIR=/tmp/big npm run web:harness:build && npm run web:harness:preview
//   http://localhost:4175/?n=100000            first visit builds, a reload reopens
//   http://localhost:4175/?n=100000&fresh=1    drops the stored index first
//
// The numbers are only meaningful from this build (a Release build), not `vite dev`.

import { applyView, buildIndex, dropIndex, indexKey, putRows, queryIndex, searchRows, type IndexQuery, type ParsedTable, type Row, type TableSchema, type View } from "@workspace.sh/table-core";
import { openWebDatabase } from "../src/sqlite/client";

const params = new URLSearchParams(location.search);
const n = Number(params.get("n") ?? "10000");
const out = document.getElementById("out")!;
const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  out.textContent = lines.join("\n");
};
const ms = (from: number) => Math.round((performance.now() - from) * 10) / 10;

async function* ndjson(url: string): AsyncGenerator<Row[]> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (rest + decoder.decode(value, { stream: true })).split("\n");
    rest = lines.pop()!;
    if (lines.length) yield lines.map((l) => JSON.parse(l) as Row);
  }
  if (rest.trim()) yield [JSON.parse(rest) as Row];
}

async function* flat(batches: AsyncIterable<Row[]>): AsyncGenerator<Row> {
  for await (const batch of batches) yield* batch;
}

async function main() {
  const base = `/big-${n}.table/tables/deals`;
  const schema = (await (await fetch(`${base}/schema.json`)).json()) as TableSchema;
  const result: Record<string, unknown> = { n, userAgent: navigator.userAgent };
  const db = await openWebDatabase(`harness-${n}${params.get("tag") ?? ""}`);
  result.persistent = db.persistent;
  say(`database: ${db.persistent ? "OPFS (survives a reload)" : "memory only"}`);
  if (params.get("fresh")) await dropIndex(db, "deals");

  // The edit below moves the key on, so a reload finds "harness-2" and must accept it.
  const stored = await indexKey(db, "deals");
  const key = "harness-1";
  const stale = stored === null;
  result.reopened = !stale;
  if (stale) {
    const t0 = performance.now();
    await buildIndex(db, { name: "deals", schema, key, rows: flat(ndjson(`${base}/rows.ndjson`)) });
    result.buildMs = ms(t0);
    say(`built ${n} rows in ${result.buildMs} ms`);
  } else {
    say(`reopened the index stored by an earlier visit (key ${stored})`);
  }

  const time = async (label: string, query: IndexQuery, window: [number, number] = [0, 50]) => {
    const t0 = performance.now();
    const rows = await queryIndex(db, { name: "deals", schema, query });
    if (!rows) throw new Error(`${label}: the index declined`);
    const first = await rows.rows(window[0], window[1]);
    const took = ms(t0);
    result[label] = { ms: took, count: rows.count, first: first[0]?.id };
    say(`${label.padEnd(30)} ${String(took).padStart(8)} ms  ${rows.count} rows`);
  };
  const half = Math.floor(n / 2);
  await time("open (no view)", {});
  await time("filter stage=won", { filter: [{ field: "stage", operator: "eq", value: "won" }] });
  await time("sort amount desc (first)", { sort: [{ field: "amount", direction: "desc" }] });
  await time("sort amount desc (again)", { sort: [{ field: "amount", direction: "desc" }] });
  await time("sort title (first)", { sort: [{ field: "title", direction: "asc" }] });
  await time("page in the middle", { sort: [{ field: "amount", direction: "desc" }] }, [half, half + 50]);
  await time("search 'harbor audit'", { search: "harbor audit" });
  const t1 = performance.now();
  await putRows(db, { name: "deals", schema, key: "harness-2", rows: [{ id: "d5", title: "Edited", stage: "won", amount: 1, probability: 1, owner: "leslie" }] });
  result.editMs = ms(t1);
  say(`${"edit one row".padEnd(30)} ${String(result.editMs).padStart(8)} ms`);

  if (n <= 100_000) {
    say("checking against applyView and searchRows…");
    const rows: Row[] = [];
    for await (const b of ndjson(`${base}/rows.ndjson`)) rows.push(...b);
    const edited = rows.map((r) => (r.id === "d5" ? { id: "d5", title: "Edited", stage: "won", amount: 1, probability: 1, owner: "leslie" } : r));
    const table = { schema, rows: edited, views: [], meta: {} } as unknown as ParsedTable;
    const cases: { view: Partial<View>; search?: string }[] = [
      { view: {} },
      { view: { filter: [{ field: "stage", operator: "eq", value: "won" }] } },
      { view: { filter: [{ field: "amount", operator: "gt", value: 50000 }], sort: [{ field: "close_date", direction: "asc" }] } },
      { view: { sort: [{ field: "stage", direction: "asc" }, { field: "amount", direction: "desc" }] } },
      { view: { sort: [{ field: "title", direction: "desc" }] } },
      { view: {}, search: "harbor audit" },
      { view: { filter: [{ field: "owner", operator: "in", value: ["sam", "ada"] }] }, search: "renewal" },
      { view: { filter: [{ field: "weighted", operator: "gte", value: 20000 }] } },
    ];
    let bad = 0;
    for (const c of cases) {
      const view = { id: "v", name: "v", layout: "table", ...c.view } as View;
      let want = applyView(table, view);
      if (c.search) want = searchRows(want, c.search, { schema });
      const got = await queryIndex(db, { name: "deals", schema, query: { filter: view.filter, sort: view.sort, search: c.search } });
      const same = got && got.count === want.length && JSON.stringify((await got.rows(0, want.length)).map((r) => r.id)) === JSON.stringify(want.map((r) => r.id));
      if (!same) {
        bad++;
        say(`MISMATCH ${JSON.stringify(c)}`);
      }
    }
    result.parity = { cases: cases.length, mismatches: bad };
    say(`parity: ${cases.length - bad}/${cases.length} queries match`);
  }
  await db.close();
  return result;
}

(window as unknown as { done: Promise<unknown> }).done = main().then(
  (r) => {
    say("done");
    document.title = "done";
    return r;
  },
  (e) => {
    say(`FAILED ${e instanceof Error ? e.stack : e}`);
    document.title = "failed";
    throw e;
  },
);
