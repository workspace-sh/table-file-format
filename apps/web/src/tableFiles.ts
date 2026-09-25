// Download and open real `.table.zip` files (#86 step 4), through core's
// archive reader and writer (D27, D28). The DOM parts stay in App; this is
// what can be tested without a browser.

import { readTableArchive, writeTableArchive } from "@workspace.sh/table-core";
import type { ParsedTable, ValidationError } from "@workspace.sh/table-core";

import { tableKeyFor } from "./tableKey.ts";

/** The file a table downloads as. */
export function archiveFileName(key: string): string {
  return `${key}.table.zip`;
}

export async function tableToArchive(key: string, table: ParsedTable): Promise<Uint8Array> {
  // Diagnostics describe how a file was read, not the table: never written back.
  const { diagnostics: _read, ...clean } = table;
  return writeTableArchive(key, clean);
}

export interface OpenedTable {
  /** Where it goes in the demo: the archive's name, numbered if that's taken. */
  key: string;
  table: ParsedTable;
  /** What the reader skipped (D25), as lines to show. Empty when it read cleanly. */
  skipped: string[];
}

/** Read archive bytes. Throws only when there's no table to show (no schema, not a zip). */
export async function openArchive(bytes: Uint8Array, taken: Iterable<string>): Promise<OpenedTable> {
  const read = await readTableArchive(bytes);
  const { diagnostics, ...table } = read;
  const base = read.path.replace(/\.table$/, "");
  return {
    key: tableKeyFor(base, taken),
    table,
    skipped: (diagnostics ?? []).map(describeSkip),
  };
}

function describeSkip(d: ValidationError): string {
  return d.rowIndex >= 0 ? `rows.ndjson line ${d.rowIndex + 1}: ${d.message}` : d.message;
}
