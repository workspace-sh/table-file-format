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
  const at = (i: number, line: string): KeptLineAt => ({ line: i, text: line, ...(from.file ? { file: from.file } : {}), after: rows.at(-1)?.id ?? from.after ?? null });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let obj: Row;
    try {
      obj = JSON.parse(line) as Row;
    } catch (err) {
      keepLine(diagnostics, unread, at(i, line), ...notJson(line, err));
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      keepLine(diagnostics, unread, at(i, line), "isn't a row", "line.not-row");
      continue;
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      keepLine(diagnostics, unread, at(i, line), "is a row without an id", "id.missing");
      continue;
    }
    // A row whose id an earlier line has (both sides of a merge, D54): the first is the row.
    const first = seen.get(obj.id);
    if (first) {
      repeatedRow(diagnostics, unread, at(i, line), first, obj);
      continue;
    }
    seen.set(obj.id, obj);
    rows.push(obj);
  }
  return rows;
}

/** Where a line that isn't a row is: its line number from 0, its text, its file, and the id of the row before it. */
export interface KeptLineAt {
  line: number;
  text: string;
  file?: string;
  after: string | null;
}

/** Says a line that isn't a row, and keeps it as it is (SPEC section 3, skip-and-collect). */
export function keepLine(diagnostics: ValidationError[], unread: UnreadLine[] | undefined, at: KeptLineAt, why: string, code: string): void {
  const where = at.file ? `${at.file}: ` : "";
  diagnostics.push({ rowIndex: at.line, code, ...(at.file ? { file: at.file } : {}), text: at.text, message: `${where}line ${at.line + 1} ${why}, and is kept as it is: ${at.text.slice(0, 60)}` });
  unread?.push({ after: at.after, text: at.text });
}

/** Why a line that isn't JSON isn't, and its code: a merge's conflict markers (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`) are said as what they are. */
export function notJson(line: string, err: unknown): [why: string, code: string] {
  return [`isn't JSON (${message(err)})`, CONFLICT_MARKER.test(line) ? "line.conflict-marker" : "line.not-json"];
}

/** A row whose id a row before it has: the same row again loses nothing when it goes; a different one is kept as it is. */
export function repeatedRow(diagnostics: ValidationError[], unread: UnreadLine[] | undefined, at: KeptLineAt, first: Row, again: Row): void {
  const where = at.file ? `${at.file}: ` : "";
  if (JSON.stringify(first) === JSON.stringify(again)) {
    diagnostics.push({ rowIndex: at.line, code: "line.repeat-left-out", rowId: again.id, ...(at.file ? { file: at.file } : {}), text: at.text, message: `${where}line ${at.line + 1} repeats the row ${JSON.stringify(again.id)} before it exactly, and is left out` });
    return;
  }
  keepLine(diagnostics, unread, at, `repeats the id ${JSON.stringify(again.id)} of a row before it`, "line.id-repeated");
  diagnostics.at(-1)!.rowId = again.id;
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
