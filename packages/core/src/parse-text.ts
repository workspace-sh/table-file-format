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
  /** One of several rows files (D51): its name, for the message, and the last row of the files before it. */
  from: { file?: string; after?: string | null } = {},
): Row[] {
  const rows: Row[] = [];
  const lines = raw.split("\n");
  const where = from.file ? `${from.file}: ` : "";
  const skip = (i: number, line: string, why: string) => {
    diagnostics.push({ rowIndex: i, message: `${where}line ${i + 1} ${why}, and is kept as it is: ${line.slice(0, 60)}` });
    unread?.push({ after: rows.at(-1)?.id ?? from.after ?? null, text: line });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let obj: Row;
    try {
      obj = JSON.parse(line) as Row;
    } catch (err) {
      skip(i, line, `isn't JSON (${message(err)})`);
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      skip(i, line, "isn't a row");
      continue;
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      skip(i, line, "is a row without an id");
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
      message: `malformed ${label}, using defaults: ${message(err)}`,
    });
    return undefined;
  }
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
