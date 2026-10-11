import { test } from "node:test";
import assert from "node:assert/strict";
import { oo1Driver } from "./sqlite-wasm.js";
import { opDriver, type OpDatabase } from "./sqlite-op.js";
import type { SqlDriver } from "./indexer.js";
import { indexerCases } from "./indexer.cases.js";

// node:sqlite arrived in Node 22.5 and has no types here; where it's missing the index is simply untested.
// INDEXER_DRIVER=wasm runs the same tests over SQLite WASM, the engine the web demo ships;
// INDEXER_DRIVER=op over core's op-sqlite driver (the Mac's), with node:sqlite standing in for op-sqlite.
let sqlite: { DatabaseSync: new (path: string) => any } | null = null;
let wasm: { oo1: { DB: new (path: string) => any } } | null = null;
if (process.env.INDEXER_DRIVER === "wasm") {
  const init = (await import("@sqlite.org/sqlite-wasm" as string)).default as () => Promise<typeof wasm>;
  wasm = await init();
} else {
  try {
    sqlite = (await import("node:sqlite" as string)) as typeof sqlite;
  } catch {
    sqlite = null;
  }
}
const skip = sqlite || wasm ? false : "node:sqlite is not available";

/** op-sqlite's database as the driver sees it, over node:sqlite: `execute` runs every statement in its text, `executeBatch` a statement per list of values. */
function opStandIn(): OpDatabase {
  const db = new sqlite!.DatabaseSync(":memory:");
  const several = (sql: string) => /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""));
  return {
    async execute(sql, params = []) {
      if (params.length === 0 && several(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      const s = db.prepare(sql);
      return { rows: s.columns().length > 0 ? s.all(...params) : (s.run(...params), []) };
    },
    async executeBatch(commands) {
      for (const [sql, params] of commands) {
        const s = db.prepare(sql);
        const lists = params === undefined ? [[]] : Array.isArray(params[0]) ? (params as unknown[][]) : [params];
        for (const list of lists) s.run(...list);
      }
    },
    close: () => db.close(),
  };
}

function driver(): SqlDriver {
  if (wasm) return oo1Driver(new wasm.oo1.DB(":memory:"));
  if (process.env.INDEXER_DRIVER === "op") return opDriver(opStandIn());
  const db = new sqlite!.DatabaseSync(":memory:");
  const cache = new Map<string, any>();
  const prepared = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      prepared(sql).run(...params);
    },
    async all(sql, params = []) {
      return prepared(sql).all(...params);
    },
  };
}

indexerCases((name, run) => test(name, { skip }, run), assert, driver);
