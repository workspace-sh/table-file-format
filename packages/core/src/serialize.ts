import type { Row, TableMeta, TableSchema, UnreadLine } from "./types.js";
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
export function serializeRows(rows: Row[], schema: TableSchema, unread: UnreadLine[] = []): string {
  if (rows.length === 0 && unread.length === 0) return "";
  const computed = schema.fields.filter((f) => f.computed).map((f) => f.name);
  const stored = (row: Row): Row => {
    if (computed.length === 0) return row;
    const out: Row = { ...row };
    for (const name of computed) delete out[name];
    return out;
  };
  if (unread.length === 0) return rows.map((r) => JSON.stringify(stored(r))).join("\n") + "\n";
  // Lines that couldn't be read go back where they were: after the row they followed,
  // or at the end when that row has gone. A save never loses a line (SPEC section 3).
  const ids = new Set(rows.map((r) => r.id));
  const after = new Map<string | null, string[]>();
  for (const line of unread) {
    const at = line.after === null || ids.has(line.after) ? line.after : undefined;
    if (at === undefined) continue;
    after.set(at, [...(after.get(at) ?? []), line.text]);
  }
  const lines: string[] = [...(after.get(null) ?? [])];
  for (const r of rows) lines.push(JSON.stringify(stored(r)), ...(after.get(r.id) ?? []));
  for (const line of unread) if (line.after !== null && !ids.has(line.after)) lines.push(line.text);
  return lines.join("\n") + "\n";
}

/** A row as its line in a rows file: computed fields left out (SPEC section 2). */
export function rowLine(schema: TableSchema): (row: Row) => string {
  const computed = schema.fields.filter((f) => f.computed).map((f) => f.name);
  return (row) => {
    if (computed.length === 0) return JSON.stringify(row);
    const out: Row = { ...row };
    for (const name of computed) delete out[name];
    return JSON.stringify(out);
  };
}

/** Manifest stamping (SPEC section 5): format + formatVersion on every write. */
export function stampMeta(meta: TableMeta | undefined): TableMeta {
  return {
    format: "table",
    formatVersion: TABLE_FORMAT_VERSION,
    ...(meta ?? {}),
  };
}

/**
 * A table's own meta.json: its title and description, without the
 * fields that describe the bundle (`format`, `formatVersion`, `tables`).
 */
export function tableMetaOnly(meta: TableMeta | undefined): TableMeta {
  const { format: _f, formatVersion: _v, tables: _t, ...own } = (meta ?? {}) as TableMeta & { tables?: unknown };
  return own;
}

/** Body files end with a newline (POSIX, same rule as rows.ndjson). */
export function normaliseBody(content: string): string {
  return content.endsWith("\n") ? content : content + "\n";
}
