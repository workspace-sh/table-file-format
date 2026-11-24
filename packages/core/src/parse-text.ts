import type { Row, UnreadLine, ValidationError } from "./types.js";

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
export function parseRowsText(
  raw: string,
  diagnostics: ValidationError[],
  /** Given, each line that isn't a row is kept here, with the row it came after, for a writer to put back. */
  unread?: UnreadLine[],
  /**
   * One of several rows files (D51): its name, for the message, the last row
   * of the files before it, and the ids those files hold.
   */
  from: { file?: string; after?: string | null; seen?: Map<string, Row> } = {},
): Row[] {
  const rows: Row[] = [];
  const seen = from.seen ?? new Map<string, Row>();
  const lines = raw.split("\n");
  const where = from.file ? `${from.file}: ` : "";
  const skip = (i: number, line: string, why: string, code: string) => {
    diagnostics.push({ rowIndex: i, code, ...(from.file ? { file: from.file } : {}), text: line, message: `${where}line ${i + 1} ${why}, and is kept as it is: ${line.slice(0, 60)}` });
    unread?.push({ after: rows.at(-1)?.id ?? from.after ?? null, text: line });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let obj: Row;
    try {
      obj = JSON.parse(line) as Row;
    } catch (err) {
      // A merge's conflict markers (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`) are said as what they are.
      skip(i, line, `isn't JSON (${message(err)})`, CONFLICT_MARKER.test(line) ? "line.conflict-marker" : "line.not-json");
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      skip(i, line, "isn't a row", "line.not-row");
      continue;
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      skip(i, line, "is a row without an id", "id.missing");
      continue;
    }
    // A row whose id an earlier line has (both sides of a merge, D54): the first is the row.
    const first = seen.get(obj.id);
    if (first) {
      // The same row again loses nothing when it goes; a different one is kept as it is.
      if (JSON.stringify(first) === JSON.stringify(obj)) diagnostics.push({ rowIndex: i, code: "line.repeat-left-out", rowId: obj.id, ...(from.file ? { file: from.file } : {}), text: line, message: `${where}line ${i + 1} repeats the row ${JSON.stringify(obj.id)} before it exactly, and is left out` });
      else {
        skip(i, line, `repeats the id ${JSON.stringify(obj.id)} of a row before it`, "line.id-repeated");
        diagnostics.at(-1)!.rowId = obj.id;
      }
      continue;
    }
    seen.set(obj.id, obj);
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
      code: "file.malformed",
      file: label,
      message: `malformed ${label}, using defaults: ${message(err)}`,
    });
    return undefined;
  }
}

/**
 * A table whose `schema.json` is missing or isn't JSON: the one case the
 * format makes fatal (SPEC section 3, "Reader error contract"). Thrown, so
 * nothing reads such a table as one; its `code` lets an app say so plainly.
 */
export class UnreadableSchemaError extends Error {
  readonly code = "schema.unreadable";
  constructor(
    /** The schema's path. */
    readonly path: string,
    /** Why: there's no file, or what the JSON parser said. */
    readonly reason: string,
  ) {
    super(`${path}: ${reason}, so this isn't a table`);
    this.name = "UnreadableSchemaError";
  }
}

/** Reads a table's `schema.json`, throwing `UnreadableSchemaError` when it isn't JSON. */
export function parseSchemaText<T>(path: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new UnreadableSchemaError(path, `isn't JSON (${message(err)})`);
  }
}

/** A line git writes where a merge conflicts: seven of `<`, `=`, `|` or `>`, then a space or the line's end. */
const CONFLICT_MARKER = /^(<{7}|={7}|\|{7}|>{7})( |$)/;

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
