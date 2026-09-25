import type { Row, TableMeta, TableSchema } from "./types.js";
import { TABLE_FORMAT_VERSION } from "./types.js";

/**
 * Canonical serialisation shared by the directory writer and the
 * archive writer — one home so both emit identical bytes for
 * identical state (SPEC section 3, canonical write order).
 */

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * `rows.ndjson`: one row per line, NDJSON (SPEC section 3). Computed
 * fields are never stored (SPEC section 2), even when a caller hands
 * back rows that had them filled in for display.
 */
export function serializeRows(rows: Row[], schema: TableSchema): string {
  if (rows.length === 0) return "";
  const computed = schema.fields.filter((f) => f.computed).map((f) => f.name);
  const stored = (row: Row): Row => {
    if (computed.length === 0) return row;
    const out: Row = { ...row };
    for (const name of computed) delete out[name];
    return out;
  };
  return rows.map((r) => JSON.stringify(stored(r))).join("\n") + "\n";
}

/** Manifest stamping (SPEC section 5): format + formatVersion on every write. */
export function stampMeta(meta: TableMeta | undefined): TableMeta {
  return {
    format: "table",
    formatVersion: TABLE_FORMAT_VERSION,
    ...(meta ?? {}),
  };
}

/** Body files end with a newline (POSIX, same rule as rows.ndjson). */
export function normaliseBody(content: string): string {
  return content.endsWith("\n") ? content : content + "\n";
}
