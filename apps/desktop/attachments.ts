// Where an attachment's file is shown from (SPEC section 6 leaves resolving
// a filename to the app): for a folder opened from disk, the file in its
// attachments/ folder; for a fixture table, the file bundled with the app.

import { Image } from "react-native";
import { bundleOf, tableNameOf } from "@workspace.sh/table-app";
import { joinPath } from "@workspace.sh/table-core/io";

// Every fixture attachment, bundled as an asset, as the web app does with
// import.meta.glob. Keys look like ./crm.table/tables/companies/attachments/co-atlas.svg.
const fixtureFiles = (
  require as unknown as {
    context: (dir: string, deep: boolean, match: RegExp) => { keys(): string[]; (key: string): number };
  }
).context("../../fixtures", true, /\/attachments\/[^/]+$/);

/** Each fixture table's attachments, by `bundle/table` key, then filename. */
const fixtureUrls: Record<string, Record<string, string>> = {};
for (const key of fixtureFiles.keys()) {
  const m = /^\.\/([^/]+)\.table\/tables\/([^/]+)\/attachments\/(.+)$/.exec(key);
  if (!m) continue;
  const uri = Image.resolveAssetSource(fixtureFiles(key))?.uri;
  if (uri) (fixtureUrls[`${m[1]}/${m[2]}`] ??= {})[m[3]!] = uri;
}

/**
 * An attachment of the table under `tableKey`: from its folder when the
 * bundle was opened from disk (`folders`, bundle key to path), else from the
 * fixtures bundled with the app. Undefined when there's no such file known.
 */
export function attachmentUrl(tableKey: string, fileName: string, folders: Record<string, string>): string | undefined {
  if (!fileName || fileName.includes("/")) return undefined;
  const folder = folders[bundleOf(tableKey)];
  if (folder) return `file://${encodeURI(joinPath(folder, "tables", tableNameOf(tableKey), "attachments", fileName))}`;
  return fixtureUrls[tableKey]?.[fileName];
}
