import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "./types.js";
import { normaliseBody, pretty, serializeNdjson, stampMeta } from "./serialize.js";

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

  const meta: TableMeta = stampMeta(input.meta);

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
    await stage(join(dir, "rows.ndjson"), serializeNdjson(input.rows));
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
