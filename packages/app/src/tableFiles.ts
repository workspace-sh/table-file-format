// Download and open real `.table.zip` files (#86 step 4), through core's
// archive reader and writer (D27, D28). An archive carries a whole bundle,
// every table in it (D37). The DOM parts stay in App; this is what can be
// tested without a browser.

import { orderedTables, readTableArchive, writeTableArchive, type ReadArchiveOptions } from "@workspace.sh/table-core";
import type { ParsedBundle, ValidationError } from "@workspace.sh/table-core";

import { tableKeyFor } from "./tableKey.ts";

/** The file a bundle downloads as. */
export function archiveFileName(key: string): string {
  return `${key}.table.zip`;
}

export async function bundleToArchive(key: string, bundle: ParsedBundle): Promise<Uint8Array> {
  // Diagnostics describe how a file was read, not the table: never written back.
  const tables = Object.fromEntries(
    orderedTables(bundle).map(([name, { diagnostics: _read, ...clean }]) => [name, clean]),
  );
  return writeTableArchive(key, { meta: bundle.meta, tables });
}

export interface OpenedBundle {
  /** Where it goes in the demo: the archive's name, numbered if that's taken. */
  key: string;
  bundle: ParsedBundle;
  /** What the reader skipped (D25), as lines to show. Empty when it read cleanly. */
  skipped: string[];
}

/**
 * Read archive bytes. Throws only when there's nothing to show: not a zip,
 * or a bundle with no table in it.
 */
export async function openArchive(bytes: Uint8Array, taken: Iterable<string>, options: ReadArchiveOptions = {}): Promise<OpenedBundle> {
  const read = await readTableArchive(bytes, options);
  const names = orderedTables(read);
  if (names.length === 0) {
    throw new Error((read.diagnostics ?? []).map((d) => d.message).join("; ") || "there's no table in it");
  }
  const skipped = (read.diagnostics ?? []).map((d) => d.message);
  const tables: ParsedBundle["tables"] = {};
  for (const [name, { diagnostics, ...table }] of names) {
    tables[name] = table;
    for (const d of diagnostics ?? []) skipped.push(`${name}: ${describeSkip(d)}`);
  }
  const { diagnostics: _bundle, ...rest } = read;
  return {
    key: tableKeyFor(read.path.replace(/\.table$/, ""), taken),
    bundle: { ...rest, tables },
    skipped,
  };
}

function describeSkip(d: ValidationError): string {
  return d.rowIndex >= 0 ? `rows.ndjson line ${d.rowIndex + 1}: ${d.message}` : d.message;
}

/**
 * What an app says after opening an archive the reader skipped parts of
 * (D25): a heading and the lines skipped. Null when it read cleanly.
 */
export function importSkippedText(opened: OpenedBundle): { heading: string; body: string } | null {
  return skippedText(opened.bundle.meta.title ?? opened.key, opened.skipped);
}

/** The same, for whatever was opened, by its title. */
export function skippedText(title: string, skipped: string[]): { heading: string; body: string } | null {
  const n = skipped.length;
  if (n === 0) return null;
  return {
    heading: `Opened "${title}", but skipped ${n} ${n === 1 ? "thing" : "things"} it couldn't read:`,
    body: skipped.join("\n"),
  };
}

/** What an app says when a bundle can't be exported. */
export function exportFailedText(fileName: string, error: unknown): string {
  return `Couldn't export ${fileName}: ${error instanceof Error ? error.message : String(error)}`;
}

/** What an app says when a file can't be opened at all. */
export function openFailedText(fileName: string, error: unknown): string {
  return `Couldn't open ${fileName}: ${error instanceof Error ? error.message : String(error)}`;
}


/** The most rows of a table held in the index that an archive is made of: it is put together in memory. */
export const ARCHIVE_ROWS = 250_000;

/**
 * What an app says when asked to make a `.table.zip` of a file with a table
 * too large for that. It makes none: an archive missing a table's rows
 * would look like a copy of the file and not be one.
 */
export function tooLargeToArchiveText(tableName: string, rows: number): { heading: string; body: string } {
  return {
    heading: "Can't make a .table.zip of this file yet",
    body: `${tableName} has ${rows.toLocaleString()} rows, and a .table.zip can be made of a table of up to ${ARCHIVE_ROWS.toLocaleString()} for now.`,
  };
}
