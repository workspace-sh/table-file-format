// A bundle's index on disk, for a Node app (Linux): `index.sqlite` at the
// bundle's root (SPEC section 8), built from a table's files without ever
// holding its rows, kept fresh as rows are edited, and saved back to
// `rows.ndjson`. Nothing here draws: an app runs it off the thread that
// does (apps/linux's index worker), or in place for a test.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { buildIndex, buildSearchIndex, isIndexStale, queryIndex, setIndexKey, storedRows, type Row, type SqlDriver, type TableSchema, type View } from "@workspace.sh/table-core";
import { openNodeDatabase } from "@workspace.sh/table-core/sqlite-node";

import { canBeIndexed, INDEXED_FROM } from "./indexed.ts";

/** What an app asks of a bundle's index: the indexer's SqlDriver, and the work on files that goes with it. */
export interface IndexHost extends SqlDriver {
  /**
   * Make table `name`'s index fresh for the files in `tableDir`, building
   * it when it is missing or stale, and say how many rows it has.
   * `onProgress` hears how many rows are in, of how many, while it builds.
   */
  ensure(name: string, tableDir: string, onProgress?: (done: number, total: number) => void): Promise<number>;
  /**
   * Make what's left of table `name`'s search index, which a build leaves
   * for after: the table is read and answering before a search has its
   * own index, and until then a search reads every row's text. Resolves
   * when it's whole; safe to ask of one that already is.
   */
  search(name: string): Promise<void>;
  /** Make table `name`'s index again from the files in `tableDir`, whatever it holds: after a change to its fields. */
  build(name: string, tableDir: string, onProgress?: (done: number, total: number) => void): Promise<number>;
  /**
   * After edits: write the table's rows out of the index to its
   * `rows.ndjson` (when `rows` is true), without the keys in `omit`
   * (fields the table no longer has), and say the index is fresh for the
   * files as they now are.
   */
  save(name: string, tableDir: string, rows: boolean, omit?: string[]): Promise<void>;
  close(): Promise<void>;
}

/** How many rows a table's `rows.ndjson` holds: its lines that aren't blank. */
export async function countRows(tableDir: string): Promise<number> {
  let count = 0;
  let blank = true;
  for await (const chunk of createReadStream(join(tableDir, "rows.ndjson"))) {
    for (const byte of chunk as Buffer) {
      if (byte === 10) {
        if (!blank) count++;
        blank = true;
      } else if (byte !== 13 && byte !== 32 && byte !== 9) blank = false;
    }
  }
  return blank ? count : count + 1;
}

/** Whether a table's rows file is large enough to be worth counting: under this many bytes it can't hold `rows` rows. */
export function mayHoldRows(tableDir: string, rows: number): boolean {
  try {
    // A row is at least `{"id":"x"}` and a newline.
    return statSync(join(tableDir, "rows.ndjson")).size >= rows * 11;
  } catch {
    return false;
  }
}

const bodyFiles = (tableDir: string): string[] => {
  try {
    return readdirSync(join(tableDir, "bodies"))
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
};

/** A table's content as one hash: its schema, its rows and its pages (SPEC section 8, "Staleness contract"). */
export async function tableContentKey(tableDir: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(readFileSync(join(tableDir, "schema.json")));
  hash.update("\0");
  for await (const chunk of createReadStream(join(tableDir, "rows.ndjson"))) hash.update(chunk as Buffer);
  for (const name of bodyFiles(tableDir)) {
    hash.update(`\0${name}\0`);
    hash.update(readFileSync(join(tableDir, "bodies", name)));
  }
  return hash.digest("hex");
}

function rowsOf(tableDir: string, onRow: () => void): AsyncIterable<Row> {
  return rowsFrom(createReadStream(join(tableDir, "rows.ndjson")), onRow);
}

async function* rowsFrom(input: NodeJS.ReadableStream, onRow: () => void = () => {}): AsyncIterable<Row> {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim().length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      // A line that doesn't parse is skipped, as the reader skips it (SPEC section 3).
      continue;
    }
    if (row === null || typeof row !== "object" || typeof (row as Row).id !== "string") continue;
    onRow();
    yield row as Row;
  }
}

/**
 * A table's first `count` rows as its file has them, without reading the
 * rest: what an app shows while a large table's index is being made.
 */
export async function firstRows(tableDir: string, count: number): Promise<Row[]> {
  const rows: Row[] = [];
  const input = createReadStream(join(tableDir, "rows.ndjson"));
  try {
    for await (const row of rowsFrom(input)) {
      rows.push(row);
      if (rows.length >= count) break;
    }
  } finally {
    input.destroy();
  }
  return rows;
}

/** Build table `name`'s index from the files in `tableDir`, streaming its rows. Resolves with how many went in. */
export async function buildTableIndex(db: SqlDriver, name: string, tableDir: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const schema = JSON.parse(readFileSync(join(tableDir, "schema.json"), "utf8")) as TableSchema;
  const key = await tableContentKey(tableDir);
  const total = onProgress ? await countRows(tableDir) : 0;
  const bodies: Record<string, string> = {};
  for (const file of bodyFiles(tableDir)) bodies[file.slice(0, -".md".length)] = readFileSync(join(tableDir, "bodies", file), "utf8");
  let done = 0;
  onProgress?.(0, total);
  await buildIndex(db, {
    name,
    schema,
    rows: rowsOf(tableDir, () => {
      done++;
      if (done % 5000 === 0) onProgress?.(done, total);
    }),
    bodies,
    key,
    // The search's own index is most of a build's time, and nothing waits on it (IndexHost.search).
    search: "later",
  });
  onProgress?.(done, total);
  return done;
}

/** Write table `name`'s rows out of the index to `tableDir`'s `rows.ndjson`, replacing it in one rename. */
export async function saveTableRows(db: SqlDriver, name: string, tableDir: string, omit: string[] = []): Promise<void> {
  const schema = JSON.parse(readFileSync(join(tableDir, "schema.json"), "utf8")) as TableSchema;
  const target = join(tableDir, "rows.ndjson");
  const out = createWriteStream(`${target}.tmp`);
  try {
    for await (const text of storedRows(db, { name, schema, omit })) {
      if (!out.write(text)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
  } catch (error) {
    out.destroy();
    throw error;
  }
  renameSync(`${target}.tmp`, target);
}

/**
 * For readBundle's `rowsElsewhere`: true for a table with `from` rows or
 * more that the index can hold (canBeIndexed). Small files are told by
 * their size, without reading them.
 */
export function largeTables(from: number = INDEXED_FROM): (tableDir: string) => Promise<boolean> {
  return async (tableDir) => {
    if (!mayHoldRows(tableDir, from)) return false;
    try {
      const schema = JSON.parse(readFileSync(join(tableDir, "schema.json"), "utf8")) as TableSchema;
      const viewsPath = join(tableDir, "views.json");
      const views = existsSync(viewsPath) ? (JSON.parse(readFileSync(viewsPath, "utf8")) as View[]) : [];
      if (!canBeIndexed({ schema, views })) return false;
    } catch {
      // The reader says what's wrong with it.
      return false;
    }
    return (await countRows(tableDir)) >= from;
  };
}

/** The index stays out of git (SPEC section 8): the bundle's .gitignore names it. */
function ignoreIndex(bundleDir: string): void {
  const path = join(bundleDir, ".gitignore");
  const have = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (have.split(/\r?\n/).some((line) => line.trim() === "index.sqlite*")) return;
  if (have.length === 0) writeFileSync(path, "index.sqlite*\n");
  else appendFileSync(path, `${have.endsWith("\n") ? "" : "\n"}index.sqlite*\n`);
}

/** The bundle at `bundleDir`'s index, opened (or made) in this thread. */
export function openIndexHost(bundleDir: string): IndexHost {
  const db = openNodeDatabase(join(bundleDir, "index.sqlite"));
  ignoreIndex(bundleDir);
  return {
    exec: db.exec,
    run: db.run,
    all: db.all,
    batch: db.batch!,
    async ensure(name, tableDir, onProgress) {
      const schema = JSON.parse(readFileSync(join(tableDir, "schema.json"), "utf8")) as TableSchema;
      const fresh = !(await isIndexStale(db, name, await tableContentKey(tableDir)));
      const held = fresh ? await queryIndex(db, { name, schema }) : null;
      if (held) return held.count;
      const count = await buildTableIndex(db, name, tableDir, onProgress);
      // The build is in the file itself, not left in its journal beside it.
      await db.exec("pragma wal_checkpoint(truncate)");
      return count;
    },
    async search(name) {
      while (await buildSearchIndex(db, name)) {
        // A step at a time.
      }
      await db.exec("pragma wal_checkpoint(truncate)");
    },
    async build(name, tableDir, onProgress) {
      const count = await buildTableIndex(db, name, tableDir, onProgress);
      await db.exec("pragma wal_checkpoint(truncate)");
      return count;
    },
    async save(name, tableDir, rows, omit) {
      if (rows) await saveTableRows(db, name, tableDir, omit);
      await setIndexKey(db, name, await tableContentKey(tableDir));
    },
    async close() {
      await db.exec("pragma wal_checkpoint(truncate)").catch(() => {});
      db.close();
    },
  };
}
