// What the phone's SQLite can do for the index (#363), measured on the
// device: expo-sqlite's own SQLite (it bundles one; iOS's is not used),
// the features core's indexer asks of it, the indexer's tests run over it,
// and the timings scripts/big-table-index.mts takes in Node, for the same
// deal-shaped table (scripts/big-table.mts, same seed). Opened by
// app/sqlite.tsx; nothing here runs in an ordinary build.

import { openDatabaseSync } from "expo-sqlite";
import { File, Paths } from "expo-file-system";
import { buildIndex, buildSearchIndex, putRows, queryIndex, type IndexQuery, type Row, type TableSchema } from "@workspace.sh/table-core";
import { expoDriver, type ExpoDriver } from "@workspace.sh/table-core/sqlite-expo";
import { indexerCases, type CaseAssert } from "@workspace.sh/table-core/indexer-cases";

export type Mode = "async" | "sync";
export type Results = Record<string, unknown>;

// Not finalizing every statement on close: see expoDriver.
const OPEN = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false };

const ms = async <T,>(run: () => Promise<T>): Promise<[number, T]> => {
  const t = performance.now();
  const out = await run();
  return [Math.round((performance.now() - t) * 10) / 10, out];
};

/** Each of the indexer's SQL features, tried: true, or what SQLite said. */
export async function features(): Promise<Results> {
  const db = openDatabaseSync(":memory:", OPEN);
  const out: Results = {};
  try {
    out.version = (await db.getFirstAsync<{ v: string }>("select sqlite_version() as v"))?.v;
    const options = (await db.getAllAsync<{ compile_options: string }>("pragma compile_options")).map((r) => r.compile_options);
    out.compileOptions = options;
    const tried: Record<string, unknown> = {};
    const attempt = async (name: string, run: () => Promise<unknown>) => {
      try {
        tried[name] = await run();
      } catch (error) {
        tried[name] = `failed: ${String(error)}`;
      }
    };
    await attempt("fts5 trigram, external content", async () => {
      await db.execAsync(
        "create table c(pos integer primary key, s text); create virtual table f using fts5(s, content='c', content_rowid='pos', tokenize='trigram');" +
          "insert into c values (1, 'Northwind renewal'), (2, 'Ünïcode İstanbul'); insert into f(rowid, s) select pos, s from c;",
      );
      const found = await db.getAllAsync<{ pos: number }>("select rowid as pos from f where f match ? order by rowid", ['"thwi"']);
      const folded = await db.getAllAsync<{ pos: number }>("select rowid as pos from f where f match ? order by rowid", ['"NORTH"']);
      return found.length === 1 && found[0]!.pos === 1 && folded.length === 1 ? true : { found, folded };
    });
    await attempt("window function row_number", async () => {
      const rows = await db.getAllAsync<{ x: number; rn: number }>("select x, row_number() over (order by x) as rn from (select 3 as x union all select 1 union all select 2)");
      return rows.map((r) => `${r.x}:${r.rn}`).join(",") === "1:1,2:2,3:3" ? true : rows;
    });
    await attempt("json_each", async () => {
      const row = await db.getFirstAsync<{ n: number }>("select count(*) as n from json_each(?)", ["[1, \"a\", null]"]);
      return row?.n === 3 ? true : row;
    });
    await attempt("index on an expression", async () => {
      await db.execAsync("create table e(c text); create index e_c on e(nullif(c, '')); insert into e values (''), ('x');");
      const row = await db.getFirstAsync<{ n: number }>("select count(*) as n from e where nullif(c, '') is not null");
      return row?.n === 1 ? true : row;
    });
    await attempt("x is ? with a bound null", async () => {
      const row = await db.getFirstAsync<{ n: number }>("select count(*) as n from (select null as x union all select 1) where x is ?", [null]);
      return row?.n === 1 ? true : row;
    });
    await attempt("page_size 32768 before tables", async () => {
      const file = openDatabaseSync(`probe-page-${Date.now()}.sqlite`, OPEN);
      try {
        file.execSync("pragma page_size = 32768; pragma journal_mode = wal; create table t(x);");
        const size = file.getFirstSync<{ page_size: number }>("pragma page_size")?.page_size;
        return size === 32768 ? true : size;
      } finally {
        file.closeSync();
      }
    });
    out.tried = tried;
  } finally {
    db.closeSync();
  }
  return out;
}

// node:assert/strict's checks, as far as the cases use them. deepEqual
// compares own keys and values strictly, but not prototypes.
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};
const fail = (message: string | undefined, actual: unknown, expected: unknown) => {
  throw new Error(`${message ?? "not equal"}\n  actual: ${JSON.stringify(actual)?.slice(0, 400)}\n  expected: ${JSON.stringify(expected)?.slice(0, 400)}`);
};
const assert: CaseAssert = {
  equal: (a, b, m) => void (Object.is(a, b) || fail(m, a, b)),
  deepEqual: (a, b, m) => void (same(a, b) || fail(m, a, b)),
  ok: (v, m) => void (v || fail(m, v, true)),
  rejects: async (p, re) => {
    try {
      await p;
    } catch (error) {
      if (!re.test(String(error instanceof Error ? error.message : error))) throw new Error(`rejected with ${String(error)}, not ${re}`);
      return;
    }
    throw new Error(`did not reject (wanted ${re})`);
  },
};

/** The indexer's own tests (core's indexer.cases.ts), over this SQLite. */
export async function cases(mode: Mode, onCase?: (line: string) => void): Promise<Results> {
  const registered: [string, () => void | Promise<void>][] = [];
  let opened: ExpoDriver[] = [];
  indexerCases(
    (name, run) => registered.push([name, run]),
    assert,
    () => {
      const driver = expoDriver(openDatabaseSync(":memory:", OPEN), mode);
      opened.push(driver);
      return driver;
    },
  );
  const out: Results = {};
  let passed = 0;
  for (const [name, run] of registered) {
    const t = performance.now();
    try {
      await run();
      passed++;
      out[name] = `ok ${Math.round(performance.now() - t)} ms`;
    } catch (error) {
      out[name] = `FAILED ${String(error instanceof Error ? error.message : error)}`;
    }
    for (const driver of opened) await driver.close();
    opened = [];
    onCase?.(`${name}: ${String(out[name]).split("\n")[0]}`);
  }
  return { passed, of: registered.length, cases: out };
}

// scripts/big-table.mts's table, row for row: the same seed and the same order of draws.
const BIG_SCHEMA: TableSchema = {
  fields: [
    { name: "title", type: "string", constraints: { required: true } },
    {
      name: "stage",
      type: "string",
      constraints: {
        enum: [
          { value: "lead", color: "gray" },
          { value: "qualified", color: "blue" },
          { value: "proposal", color: "purple" },
          { value: "negotiation", color: "orange" },
          { value: "won", color: "green" },
          { value: "lost", color: "red" },
        ],
      },
    },
    { name: "amount", type: "number", format: "currency" },
    { name: "probability", type: "number" },
    { name: "owner", type: "string" },
    { name: "close_date", type: "date" },
    { name: "note", type: "string" },
    { name: "weighted", type: "number", format: "currency", computed: { expr: "(round (* amount probability) 0)", dialect: "table-expr-v1" } },
  ],
} as TableSchema;

async function* bigRows(n: number): AsyncIterable<Row> {
  let seed = 0x7ab1e;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const stages = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
  const owners = ["leslie", "sam", "claude", "maya", "jonas", "priya", "ada", "kofi"];
  const words = ["Atlas", "Northwind", "Lumen", "Tidal", "Quill", "Fern", "Harbor", "Summit", "Cedar", "Orbit", "Delta", "Echo"];
  const kinds = ["renewal", "expansion", "pilot", "migration", "audit", "rollout", "support plan", "licence"];
  const notes = ["Follow up next week.", "Waiting on procurement.", "Champion is keen.", "Needs a security review.", "Budget confirmed.", ""];
  for (let i = 0; i < n; i++) {
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 28);
    const row: Row = {
      id: `d${i.toString(36)}`,
      title: `${pick(words)} ${pick(kinds)} ${i + 1}`,
      stage: pick(stages),
      amount: Math.round(random() * 200) * 500,
      probability: Math.round(random() * 100) / 100,
      owner: pick(owners),
      close_date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    } as Row;
    const note = pick(notes);
    if (note) (row as Record<string, unknown>).note = note;
    yield row;
  }
}

/** The longest the JS thread went without running a timer while `run` ran: how long a frame's JS would have waited. */
async function longestStall<T>(run: () => Promise<T>): Promise<[number, T]> {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 8);
  try {
    const out = await run();
    // A thread held to the end never ran the timer at all: that wait counts too.
    longest = Math.max(longest, performance.now() - last);
    return [Math.round(longest), out];
  } finally {
    clearInterval(timer);
  }
}

/** A driver that counts the statements asked of it: each is a crossing to SQLite and back. */
function counting(driver: ExpoDriver): ExpoDriver & { crossings: number } {
  const out = {
    crossings: 0,
    exec: (sql: string) => (out.crossings++, driver.exec(sql)),
    run: (sql: string, params?: Parameters<ExpoDriver["run"]>[1]) => (out.crossings++, driver.run(sql, params)),
    all: (sql: string, params?: Parameters<ExpoDriver["all"]>[1]) => (out.crossings++, driver.all(sql, params)),
    batch: (sql: string, lists: Parameters<NonNullable<ExpoDriver["batch"]>>[1]) => (out.crossings++, driver.batch!(sql, lists)),
    close: () => driver.close(),
  };
  return out;
}

/** big-table-index.mts's timings, at `n` rows, into a file in the app's documents, plus a search before and after its index is whole. */
export async function timings(n: number, mode: Mode): Promise<Results> {
  const name = `probe-${n}-${mode}.sqlite`;
  const file = new File(Paths.document, "SQLite", name);
  if (file.exists) file.delete();
  for (const extra of ["-wal", "-shm"]) {
    const f = new File(Paths.document, "SQLite", name + extra);
    if (f.exists) f.delete();
  }
  const raw = openDatabaseSync(name, OPEN);
  raw.execSync("pragma page_size = 32768; pragma journal_mode = wal; pragma synchronous = normal;");
  const driver = counting(expoDriver(raw, mode));
  const schema = BIG_SCHEMA;
  const out: Results = { rows: n, mode };
  try {
    const [stall, [buildMs]] = await longestStall(() => ms(() => buildIndex(driver, { name: "deals", schema, rows: bigRows(n), key: "k", search: "later" })));
    out.rowsInMs = buildMs;
    out.longestJsStallWhileBuildingMs = stall;
    const open = (query: IndexQuery) => queryIndex(driver, { name: "deals", schema, query });

    let before = driver.crossings;
    const [plainMs, plain] = await ms(async () => (await open({}))!);
    out.count = plain.count;
    out.openMs = plainMs;
    out.openCrossings = driver.crossings - before;
    const middle = Math.floor(plain.count / 2);
    [out.pageMiddleMs] = await ms(() => plain.rows(middle, middle + 200));
    const [, ids] = await ms(() => plain.ids(middle, middle + 1));
    [out.placeOfMs] = await ms(() => plain.placeOf(ids[0]!));
    [out.rowMs] = await ms(() => plain.row(ids[0]!));

    for (const pass of ["first", "again"]) {
      const t: Results = {};
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

    const search = async () => {
      const [openMs, found] = await ms(async () => (await open({ search: "northwind audit 1" }))!);
      const [pageMs] = await ms(() => found.rows(0, 200));
      return { found: found.count, openMs, pageMs };
    };
    out.searchBeforeItsIndex = await search();
    const [searchStall, [searchIndexMs]] = await longestStall(() =>
      ms(async () => {
        while (await buildSearchIndex(driver, "deals")) {}
      }),
    );
    out.searchIndexMs = searchIndexMs;
    out.longestJsStallWhileIndexingSearchMs = searchStall;
    out.searchAfterItsIndex = await search();

    const row = (await plain.row(ids[0]!))!;
    before = driver.crossings;
    [out.editMs] = await ms(() => putRows(driver, { name: "deals", schema, rows: [{ ...row, title: "Edited" }], key: "k2" }));
    out.editCrossings = driver.crossings - before;
    // One crossing alone: the smallest statement there is.
    const t = performance.now();
    for (let i = 0; i < 500; i++) await driver.all("select 1 as x");
    out.oneCrossingMs = Math.round(((performance.now() - t) / 500) * 1000) / 1000;
    [out.reopenAfterEditMs] = await ms(async () => (await (await open({}))!.rows(middle, middle + 200)).length);
    raw.execSync("pragma wal_checkpoint(truncate);");
    out.fileMB = Math.round((file.size ?? 0) / 1e5) / 10;
  } catch (error) {
    out.error = String(error instanceof Error ? (error.stack ?? error.message) : error);
  } finally {
    await driver.close();
    if (file.exists) file.delete();
  }
  return out;
}

/** Where the results are kept on the device, for `devicectl device copy from`. */
export function saveResults(results: Results): void {
  const file = new File(Paths.document, "sqlite-probe.json");
  file.write(JSON.stringify(results, null, 2));
}
