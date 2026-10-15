// Download and open single-file `.table`s (SPEC section 13, D49, D50),
// through core's archive reader and writer (D27, D28). A single file
// carries a whole bundle, every table in it (D37), with its attachments.
// The DOM parts stay in App; this is what can be tested without a browser.

import { TextDecoder } from "@exodus/bytes/encoding-lite.js";
import { newBundle, orderedTables, readTableArchive, tableFromCSV, writeTableArchive, type ReadArchiveOptions } from "@workspace.sh/table-core";
import { fieldKey } from "@workspace.sh/table-ui/shared";
import type { ParsedBundle } from "@workspace.sh/table-core";

import { tableKeyFor } from "./tableKey.ts";

/** The single file a bundle is saved or downloaded as: `<key>.table` (D50). */
export function singleFileName(key: string): string {
  return `${key}.table`;
}

/** A bundle as a single file's bytes: every table, and its other files (attachments, files no reader knows). */
export async function bundleToArchive(key: string, bundle: ParsedBundle): Promise<Uint8Array> {
  // Diagnostics describe how a file was read, not the table: never written back.
  const tables = Object.fromEntries(
    orderedTables(bundle).map(([name, { diagnostics: _read, ...clean }]) => [name, clean]),
  );
  return writeTableArchive(key, { meta: bundle.meta, tables, ...(bundle.files ? { files: bundle.files } : {}) });
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
    for (const d of diagnostics ?? []) skipped.push(`${name}: ${d.message}`);
  }
  const { diagnostics: _bundle, ...rest } = read;
  return {
    key: tableKeyFor(read.path.replace(/\.table$/, ""), taken),
    bundle: { ...rest, tables },
    skipped,
  };
}

// -- A spreadsheet someone already has: CSV, TSV and the like, opened as a new .table file ----

/** Whether a file is a spreadsheet as text, by its name: comma, tab or otherwise separated. */
export function isSpreadsheetFile(name: string): boolean {
  return /\.(csv|tsv|tab|txt)$/i.test(name);
}

/**
 * A spreadsheet file's bytes as text. UTF-8 when they are that; Excel's
 * "Unicode text" is UTF-16 and says so in its first two bytes; anything
 * else is read as Windows-1252, which is what older Excel wrote, so a £ or
 * an é comes through. Decoded with @exodus/bytes's TextDecoder, the
 * standard one, rather than the host's: the Mac's Hermes has none, only a
 * polyfill that knows UTF-8 and refuses `fatal`.
 */
export function spreadsheetText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** A file's name as a title: `Q4_sales-2026.csv` is "Q4 sales 2026". */
function titleOf(fileName: string): string {
  const title = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "Table";
}

/**
 * A spreadsheet as a new `.table` file holding one table, named after the
 * file: its headings the fields, its lines the rows (core's tableFromCSV,
 * with the keys an app's own new fields get), and one table view of them
 * all. Throws when there is nothing in it to make a table of. `taken`:
 * the names already used, which this one is kept unlike.
 */
export function openSpreadsheet(text: string, fileName: string, taken: Iterable<string>, now?: Date): OpenedBundle {
  const read = tableFromCSV(text, { keyOf: fieldKey });
  if (read.schema.fields.length === 0) throw new Error("there's nothing in it");
  const title = titleOf(fileName);
  const key = tableKeyFor(title, taken);
  const name = tableKeyFor(title, []);
  const made = newBundle(title, `${key}.table`, name, now);
  const table = made.tables[name]!;
  const skipped =
    read.extraCells > 0
      ? [`${read.extraCells} ${read.extraCells === 1 ? "cell was" : "cells were"} past the last heading, and left out.`]
      : [];
  return {
    key,
    bundle: { ...made, tables: { [name]: { ...table, schema: { ...table.schema, fields: read.schema.fields }, rows: read.rows } } },
    skipped,
  };
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


/** The most rows of a table held in the index that a single file is made of: it is put together in memory. */
export const ARCHIVE_ROWS = 250_000;

/**
 * What an app says when asked to save a file with a table too large for
 * that as a single file. It makes none: a single file missing a table's
 * rows would look like a copy of the file and not be one.
 */
export function tooLargeToArchiveText(tableName: string, rows: number): { heading: string; body: string } {
  return {
    heading: "Can't save this as a single file yet",
    body: `${tableName} has ${rows.toLocaleString()} rows, and a single-file .table can be made of a table of up to ${ARCHIVE_ROWS.toLocaleString()} for now.`,
  };
}
