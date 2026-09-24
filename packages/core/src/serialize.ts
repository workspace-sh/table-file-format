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
 * `rows.ndjson`, one cell per line (SPEC section 3, DECISIONS D31):
 * rows in code-point order of `id`; within a row, fields in schema
 * order, then any undeclared keys in code-point order; empty cells
 * (absent, `null`, `""`) left out, and a row with no cells written as
 * `{"id":…}` so it still exists. Every line is followed by a blank line,
 * so no two lines a merge can change ever touch — see D31 for why.
 */
export function serializeRows(rows: Row[], schema: TableSchema): string {
  const declared = schema.fields.map((f) => f.name);
  const declaredSet = new Set(declared);
  const out: string[] = [];
  for (const row of rows.slice().sort((a, b) => compareCodePoints(a.id, b.id))) {
    const undeclared = Object.keys(row)
      .filter((k) => k !== "id" && !declaredSet.has(k))
      .sort(compareCodePoints);
    let wrote = false;
    for (const field of [...declared, ...undeclared]) {
      const value = row[field];
      if (value === undefined || value === null || value === "") continue;
      out.push(JSON.stringify({ id: row.id, [field]: value }));
      wrote = true;
    }
    if (!wrote) out.push(JSON.stringify({ id: row.id }));
  }
  return out.map((line) => `${line}\n\n`).join("");
}

/**
 * Code-point order — what every language's plain string sort agrees on
 * once surrogate pairs are read as one character (JavaScript's own
 * `<` compares UTF-16 units, which differs above U+FFFF).
 */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}

/**
 * Manifest stamping (SPEC section 5): format + formatVersion on every
 * write, over whatever the input's meta said — the files are written in
 * this version's layout, so the manifest must name this version.
 */
export function stampMeta(meta: TableMeta | undefined): TableMeta {
  return {
    ...(meta ?? {}),
    format: "table",
    formatVersion: TABLE_FORMAT_VERSION,
  };
}

/** Body files end with a newline (POSIX, same rule as rows.ndjson). */
export function normaliseBody(content: string): string {
  return content.endsWith("\n") ? content : content + "\n";
}
