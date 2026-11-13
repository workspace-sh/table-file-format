// Which attached files a session of editing left with no row naming them:
// a cell's file taken out, or replaced by another. The file stays in its
// table's attachments/ while the table is open, so undo brings the cell
// back with its file; once the table is closed it's the host's to remove.

import type { ParsedTable } from "@workspace.sh/table-core";

/** The filenames a table's attachment fields name, across its rows. Null for a table whose rows aren't all in memory. */
export function attachedNames(table: ParsedTable): Set<string> | null {
  if (table.indexed || table.loading) return null;
  const fields = table.schema.fields.filter((f) => (f as { attachment?: boolean }).attachment === true).map((f) => f.name);
  const names = new Set<string>();
  for (const row of table.rows) {
    for (const field of fields) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value === "string" && value !== "") names.add(value);
    }
  }
  return names;
}

/**
 * The files to remove from a table's attachments/ as it's closed: those its
 * rows named when it was opened (`before`) or that were attached since
 * (`added`), and that no row names now (`after`). Never a file the session
 * didn't touch: one put there by hand, or already unnamed, is left. None
 * when either set of rows isn't whole.
 */
export function droppedAttachments(before: Set<string> | null, added: Iterable<string>, after: Set<string> | null): string[] {
  if (!before || !after) return [];
  const dropped = new Set<string>();
  for (const name of [...before, ...added]) if (!after.has(name)) dropped.add(name);
  return [...dropped].sort();
}
