import type { Row, ValidationError } from "./types.js";

/**
 * Pure text-level parsing shared by the directory parser and the
 * archive reader — one home for the skip-and-collect reader contract
 * (SPEC section 3) so both surfaces behave identically on the same
 * bytes.
 */

/**
 * `rows.ndjson`, skip-and-collect (SPEC section 3, DECISIONS D25, D31).
 *
 * Every line names a row by `id` and contributes the cells it carries.
 * A writer puts one cell on each line; a line carrying a whole row (the
 * formatVersion 1 layout, or another tool's) reads by the same rule.
 * Rows come back in the order their ids first appear.
 *
 * Version-control conflict markers are understood rather than skipped
 * as noise, so a merge that conflicted still reads as a whole table:
 * anything changed on either side survives, and where both sides gave
 * one cell different values the later (incoming) side wins. A diff3
 * base section is ignored — it holds the value both sides moved away
 * from. Every conflicted cell and every cell set twice is reported.
 *
 * `rowIndex` on a diagnostic is the ZERO-BASED LINE NUMBER in the text,
 * so the report points at the actual line.
 */
export function parseNdjsonText(
  raw: string,
  diagnostics: ValidationError[],
): Row[] {
  const rows = new Map<string, Row>();
  /** Where each cell's current value came from, to report a second, different one. */
  const setAt = new Map<string, number>();
  let region: "none" | "ours" | "base" | "theirs" = "none";
  let regionStart = 0;
  let ours = new Map<string, string>();
  let theirs = new Map<string, string>();

  const endRegion = () => {
    for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
      const [rowId, field] = JSON.parse(key) as [string, string];
      const a = ours.get(key);
      const b = theirs.get(key);
      if (a !== undefined && b !== undefined && a === b) continue;
      diagnostics.push({
        rowIndex: regionStart,
        rowId,
        ...(field === "" ? {} : { field }),
        message:
          a !== undefined && b !== undefined
            ? `merge conflict: both sides changed ${field} on row ${rowId}; kept the incoming value`
            : // Without the base, "added on one side" and "deleted on the
              // other" look the same, so the message claims neither.
              `merge conflict: ${field === "" ? `row ${rowId}` : `${field} on row ${rowId}`} is on one side only; kept it`,
      });
    }
    region = "none";
    ours = new Map();
    theirs = new Map();
  };

  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (CONFLICT_START.test(line)) {
      if (region !== "none") endRegion();
      region = "ours";
      regionStart = i;
      continue;
    }
    if (region !== "none" && CONFLICT_BASE.test(line)) {
      region = "base";
      continue;
    }
    if (region !== "none" && CONFLICT_MID.test(line)) {
      region = "theirs";
      continue;
    }
    if (region !== "none" && CONFLICT_END.test(line)) {
      endRegion();
      continue;
    }
    if (line.trim().length === 0 || region === "base") continue;
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
    const id = obj.id;
    let row = rows.get(id);
    if (row === undefined) {
      row = { id };
      rows.set(id, row);
    }
    const side = region === "ours" ? ours : region === "theirs" ? theirs : undefined;
    const fields = Object.keys(obj).filter((k) => k !== "id");
    // A line with no cells still says the row exists — on a conflict side too.
    if (fields.length === 0 && side !== undefined) side.set(JSON.stringify([id, ""]), "");
    for (const field of fields) {
      const value = obj[field];
      const key = JSON.stringify([id, field]);
      if (side !== undefined) {
        side.set(key, JSON.stringify(value));
      } else if (field in row && JSON.stringify(row[field]) !== JSON.stringify(value)) {
        diagnostics.push({
          rowIndex: i,
          rowId: id,
          field,
          message: `${field} on row ${id} is set twice (lines ${(setAt.get(key) ?? 0) + 1} and ${i + 1}); kept the later value`,
        });
      }
      row[field] = value;
      setAt.set(key, i);
    }
  }
  if (region !== "none") {
    diagnostics.push({ rowIndex: regionStart, message: "merge conflict never closed; read to the end of the file" });
    endRegion();
  }
  return Array.from(rows.values());
}

// Version-control conflict markers: seven characters, then a label or nothing.
const CONFLICT_START = /^<{7}(?: |$)/;
const CONFLICT_BASE = /^\|{7}(?: |$)/;
const CONFLICT_MID = /^={7}$/;
const CONFLICT_END = /^>{7}(?: |$)/;

/** `rows.ndjson` text → rows plus diagnostics, for callers holding the text themselves. */
export function parseRowsText(raw: string): { rows: Row[]; diagnostics: ValidationError[] } {
  const diagnostics: ValidationError[] = [];
  return { rows: parseNdjsonText(raw, diagnostics), diagnostics };
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
