// Starting again from the example tables: what to ask first, and what's
// held after. Edits to the examples go, and so do tables made or opened
// from a .table.zip here; a .table folder opened from disk is the
// person's own file, so it's kept, open, as it is.

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

import { bundleOf } from "./bundles.ts";
import { CANCEL, type Confirm } from "./confirm.ts";

/** `openedFolders`: the app holds .table folders opened from disk, which a reset leaves alone. */
export function resetPrompt(options: { openedFolders: boolean }): Confirm {
  return {
    heading: "Reset the demo data?",
    body: `Every edit you made here is lost.${options.openedFolders ? " Folders you opened from disk aren't touched." : ""}`,
    responses: [CANCEL, { id: "reset", label: "Reset", destructive: true }],
  };
}

/**
 * The tables and manifests held after a reset: the examples as they
 * shipped, and every bundle in `keep` (opened folders) as it is now.
 * With nothing to keep, `examples` itself.
 */
export function afterReset(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  examples: { tables: Record<string, ParsedTable>; bundles: Record<string, BundleMeta> },
  keep: Iterable<string>,
): { tables: Record<string, ParsedTable>; bundles: Record<string, BundleMeta> } {
  const kept = new Set(keep);
  // Nothing kept: the examples themselves, so an app can tell they're untouched.
  if (kept.size === 0) return examples;
  return {
    tables: { ...examples.tables, ...Object.fromEntries(Object.entries(tables).filter(([key]) => kept.has(bundleOf(key)))) },
    bundles: { ...examples.bundles, ...Object.fromEntries(Object.entries(bundles).filter(([key]) => kept.has(key))) },
  };
}
