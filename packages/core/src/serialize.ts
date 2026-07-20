import type { Row, TableMeta } from "./types.js";
import { TABLE_FORMAT_VERSION } from "./types.js";

/**
 * Canonical serialisation shared by the directory writer and the
 * archive writer — one home so both emit identical bytes for
 * identical state (SPEC section 3, canonical write order).
 */

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function serializeNdjson(rows: Row[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
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
