import type { Row, ValidationError } from "./types.js";

/**
 * Pure text-level parsing shared by the directory parser and the
 * archive reader — one home for the skip-and-collect reader contract
 * (SPEC section 3) so both surfaces behave identically on the same
 * bytes.
 */

/**
 * NDJSON rows, skip-and-collect. `rowIndex` on a diagnostic is the
 * ZERO-BASED LINE NUMBER in the text (not the index in the returned
 * array) so the report points at the actual line to fix.
 */
export function parseNdjsonText(
  raw: string,
  diagnostics: ValidationError[],
): Row[] {
  const rows: Row[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    let obj: Row;
    try {
      obj = JSON.parse(line) as Row;
    } catch (err) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped malformed line: ${message(err)} — ${line.slice(0, 60)}`,
      });
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped non-object line: ${line.slice(0, 60)}`,
      });
      continue;
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped row missing system id: ${line.slice(0, 60)}`,
      });
      continue;
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Optional JSON content: absent (`undefined`) → undefined, silently
 * (by spec); present but malformed → undefined + a file-level
 * diagnostic (rowIndex −1) so a corrupt views.json degrades to "no
 * saved views" instead of sinking the table.
 */
export function parseOptionalJsonText<T>(
  label: string,
  raw: string | undefined,
  diagnostics: ValidationError[],
): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    diagnostics.push({
      rowIndex: -1,
      message: `malformed ${label}: ${message(err)} — using defaults`,
    });
    return undefined;
  }
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
