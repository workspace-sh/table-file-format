import type { Row, ViewFilter, ViewSort } from "./types";

/**
 * Structured query for the `index.sqlite` cache — deliberately NOT raw
 * SQL (see SPEC section 8). Reuses the view AST from views.json so the
 * indexed path and the in-memory fallback (`applyFilters` /
 * `applySort` / `searchRows`) speak one query language and cannot
 * diverge. The cache's internal layout stays an implementation
 * detail, and user-supplied search text never reaches an SQL string.
 */
export interface IndexQuery {
  filter?: ViewFilter[];
  sort?: ViewSort[];
  /**
   * Free-text search across all string-typed fields AND body
   * contents (FTS5) — mirror of `searchRows`' scope.
   */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Implementation contract (stubbed; see SPEC section 8 for the normative
 * text):
 *
 * - `buildIndex` parses rows.ndjson + bodies, inserts in one
 *   transaction into a temp file, then atomically renames over
 *   `index.sqlite`. Stores `{schema_hash, rows_hash, format_version,
 *   built_at}` in a `_meta` table.
 * - `isIndexStale` re-hashes schema.json + rows.ndjson and compares
 *   against `_meta` (hashes, not mtimes — git rewrites mtimes on
 *   checkout/pull even when content is unchanged).
 * - `queryIndex` compiles the IndexQuery to SQL internally.
 * - `dropIndex` deletes the file; always safe by the fallback rule.
 *
 * These live in core as the contract only. Concrete implementations
 * belong in optional per-platform packages (Node via `node:sqlite`,
 * RN via op-sqlite / expo-sqlite, browser via wa-sqlite + OPFS).
 */
const NOT_IMPLEMENTED = "indexer not yet implemented";

export async function buildIndex(_dirPath: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function queryIndex(
  _dirPath: string,
  _query: IndexQuery,
): Promise<Row[]> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function isIndexStale(_dirPath: string): Promise<boolean> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function dropIndex(_dirPath: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}
