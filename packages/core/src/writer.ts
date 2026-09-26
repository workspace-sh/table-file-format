import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BundleMeta, ParsedBundle, ParsedTable, Row, TableMeta, TableSchema, View } from "./types.js";
import { normaliseBody, pretty, serializeRows, stampMeta, tableMetaOnly } from "./serialize.js";
import { isTableName, tableOrder } from "./bundle.js";

export interface WriteTableInput {
  schema: TableSchema;
  rows: Row[];
  views?: View[];
  meta?: TableMeta;
  /**
   * Long-form markdown bodies, keyed by row.id.
   * Each entry becomes a `bodies/{id}.md` file.
   * On write, the bodies/ directory is wholesale-replaced — entries not
   * present in this map are deleted from disk. Use a future appendBody /
   * writeBody API for partial updates.
   */
  bodies?: Record<string, string>;
}

/**
 * Write a `.table/` directory with a staged, near-atomic commit
 * (SPEC section 1, "Writer atomicity"; DECISIONS D24):
 *
 *   Stage    — every file's full content is written to a `<name>.tmp`
 *              sibling first. Any failure here (disk full, bad body
 *              id, crash) leaves the existing table byte-for-byte
 *              intact; at worst, ignorable `*.tmp` litter remains,
 *              which readers skip by contract (unknown root files are
 *              ignored; body readers only match `*.md`).
 *   Commit   — each temp is renamed over its target. rename(2) within
 *              a directory is atomic per file, so a reader never
 *              observes a partially-written file. The commit phase is
 *              a handful of renames — the torn-window shrinks from
 *              "the whole serialisation" to microseconds.
 *   Trim     — stale body files (and an emptied bodies/ dir) are
 *              removed only after every rename has landed, so a crash
 *              can never leave bodies deleted-but-not-rewritten.
 *
 * This is atomicity against readers and crashes, not durability —
 * no fsync is issued; power-loss durability is the platform's page
 * cache policy. Apps needing stronger guarantees can fsync the
 * directory afterwards.
 */
export async function writeTable(dir: string, input: WriteTableInput | ParsedTable): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "attachments"), { recursive: true });

  // A table's meta.json carries only its own title and description:
  // `format`, `formatVersion` and `tables` describe the bundle.
  const meta: TableMeta = tableMetaOnly(input.meta);

  const bodiesDir = join(dir, "bodies");
  const bodies = input.bodies ?? {};
  const haveBodies = Object.keys(bodies).length > 0;

  // ---- Stage: write everything to *.tmp; nothing existing is touched.
  const staged: Array<{ tmp: string; target: string }> = [];
  const stage = async (target: string, content: string) => {
    const tmp = target + ".tmp";
    await writeFile(tmp, content);
    staged.push({ tmp, target });
  };

  try {
    await stage(join(dir, "schema.json"), pretty(input.schema));
    await stage(join(dir, "rows.ndjson"), serializeRows(input.rows, input.schema));
    await stage(join(dir, "views.json"), pretty(input.views ?? []));
    await stage(join(dir, "meta.json"), pretty(meta));
    if (haveBodies) {
      await mkdir(bodiesDir, { recursive: true });
      for (const [id, content] of Object.entries(bodies)) {
        await stage(join(bodiesDir, `${id}.md`), normaliseBody(content));
      }
    }
  } catch (err) {
    // Failed mid-stage: remove whatever temps we managed to write so
    // the directory returns to exactly its pre-call state, then
    // surface the original error. Cleanup failures are swallowed —
    // stray temps are inert by the reader contract.
    await Promise.allSettled(staged.map((s) => rm(s.tmp, { force: true })));
    throw err;
  }

  // ---- Commit: atomic per-file renames. No content writes happen here.
  for (const { tmp, target } of staged) {
    await rename(tmp, target);
  }

  // ---- Trim: deletions strictly after every rename has landed.
  if (haveBodies) {
    const existing = await readdir(bodiesDir).catch(() => [] as string[]);
    for (const name of existing) {
      if (!name.endsWith(".md")) continue;
      const id = name.slice(0, -".md".length);
      if (!(id in bodies)) {
        await rm(join(bodiesDir, name), { force: true });
      }
    }
  } else if (existsSync(bodiesDir)) {
    await rm(bodiesDir, { recursive: true, force: true });
  }
}

export interface WriteBundleInput {
  meta?: BundleMeta;
  tables: Record<string, WriteTableInput | ParsedTable>;
}

/**
 * Write a `.table` bundle (SPEC section 1, D37): every table under
 * `tables/<name>/` by `writeTable`, then the manifest, with the
 * `tables` order the bundle is shown in. Each file keeps D24's
 * stage-then-rename discipline. Trim comes last, as there: a table
 * directory no longer in the bundle is removed only after everything
 * else has been written.
 */
export async function writeBundle(dir: string, input: WriteBundleInput | ParsedBundle): Promise<void> {
  const names = tableOrder(input);
  for (const name of names) {
    if (!isTableName(name)) throw new Error(`invalid table name: ${JSON.stringify(name)}`);
  }
  const tablesDir = join(dir, "tables");
  await mkdir(tablesDir, { recursive: true });
  for (const name of names) {
    await writeTable(join(tablesDir, name), input.tables[name]!);
  }

  const manifest = join(dir, "meta.json");
  await writeFile(manifest + ".tmp", pretty(stampMeta({ ...(input.meta ?? {}), tables: names })));
  await rename(manifest + ".tmp", manifest);

  for (const entry of await readdir(tablesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || names.includes(entry.name)) continue;
    // Only what the reader would call a table: never an unknown directory.
    if (existsSync(join(tablesDir, entry.name, "schema.json"))) {
      await rm(join(tablesDir, entry.name), { recursive: true, force: true });
    }
  }
}
