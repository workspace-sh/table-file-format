// A .table in and out on a phone: what Open… offers in the system's picker
// (documents.ts opens it where it is), a single file's bytes read as a copy
// (measuring), a spreadsheet made a .table, and a single file handed to the
// share sheet (Save to Files, AirDrop, Mail…). Reading and writing the
// archive is table-app's (openArchive, bundleToArchive), as on the web,
// macOS and Linux; so is the wording of what went wrong.

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { BundleMeta, ParsedTable, Row } from "@workspace.sh/table-core";
import { singleFileName, bundleToArchive, fromBundle, openSpreadsheet, spreadsheetText, toBundle, type Library } from "@workspace.sh/table-app";
import { openZip } from "./indexHost";

/** What opening an archive gave: a library to take in, what was skipped, the file's name, and its large tables' first rows by `bundle/table`. */
export interface OpenedZip {
  library: Library;
  skipped: string[];
  name: string;
  first: Record<string, Row[]>;
}

/** A .table.zip that couldn't be read: its name, and why. */
export class ZipError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/**
 * An archive's bytes as a library to take in, named apart from `held`. A
 * large table in it stays compressed on its way into its index
 * (indexHost.ts): it comes with no rows, and its first rows beside it.
 */
export async function readZip(bytes: Uint8Array, held: Iterable<string>, name: string): Promise<OpenedZip> {
  let read;
  try {
    read = await openZip(bytes, held);
  } catch (error) {
    throw new ZipError(name, error);
  }
  const { opened, first } = read;
  return {
    library: {
      tables: fromBundle(opened.key, opened.bundle),
      bundles: { [opened.key]: opened.bundle.meta },
      paths: {},
      problems: {},
    },
    skipped: opened.skipped,
    name,
    first: Object.fromEntries(Object.entries(first).map(([table, rows]) => [`${opened.key}/${table}`, rows])),
  };
}

/** A spreadsheet's bytes (CSV, TSV and the like) as a new .table file to take in, named apart from `held`. */
export function readSpreadsheet(bytes: Uint8Array, held: Iterable<string>, name: string): OpenedZip {
  let opened;
  try {
    opened = openSpreadsheet(spreadsheetText(bytes), name, held);
  } catch (error) {
    throw new ZipError(name, error);
  }
  return {
    library: { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} },
    skipped: opened.skipped,
    name,
    first: {},
  };
}

/**
 * What Open… offers in the system's picker: a .table in either form (its
 * folder form is a package, one item), or a spreadsheet someone already has,
 * which becomes a new .table file.
 */
export const OPEN_TYPES = [
  "sh.workspace.table",
  "sh.workspace.table.file",
  "public.comma-separated-values-text",
  "public.tab-separated-values-text",
  "public.plain-text",
];

/**
 * A bundle as a single-file .table, offered to the share sheet (Save to Files, AirDrop, Mail…).
 * `files` are what a document holds besides its tables (attachments, files no reader knows), so
 * they go with it. Resolves once the sheet is done.
 */
export async function shareZip(
  bundle: string,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  files: Record<string, Uint8Array> = {},
): Promise<void> {
  const file = new File(Paths.cache, singleFileName(bundle));
  if (file.exists) file.delete();
  file.create();
  file.write(await bundleToArchive(bundle, { ...toBundle(tables, bundles, bundle), files }));
  await Sharing.shareAsync(file.uri, { mimeType: "application/octet-stream", UTI: "sh.workspace.table.file", dialogTitle: singleFileName(bundle) });
}
