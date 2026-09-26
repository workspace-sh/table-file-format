// Download and open real `.table.zip` files (#86 step 4), through core's
// archive reader and writer (D27, D28). An archive carries a whole bundle,
// every table in it (D37). The DOM parts stay in App; this is what can be
// tested without a browser.

import { orderedTables, readTableArchive, writeTableArchive } from "@workspace.sh/table-core";
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
export async function openArchive(bytes: Uint8Array, taken: Iterable<string>): Promise<OpenedBundle> {
  const read = await readTableArchive(bytes);
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
