// Where an attachment's file is shown from (SPEC section 6 leaves resolving
// a filename to the app): for a folder opened from disk, the file in its
// attachments/ folder; for a fixture table, the file bundled with the app
// (table-fixtures/native-attachments, shared with the mobile app).

import { bundleOf, tableNameOf } from "@workspace.sh/table-app";
import { joinPath } from "@workspace.sh/table-core/io";
import { fixtureAttachmentUrls } from "@workspace.sh/table-fixtures/native-attachments";

/**
 * An attachment of the table under `tableKey`: from its folder when the
 * bundle was opened from disk (`folders`, bundle key to path), else from the
 * fixtures bundled with the app. Undefined when there's no such file known.
 */
export function attachmentUrl(tableKey: string, fileName: string, folders: Record<string, string>): string | undefined {
  if (!fileName || fileName.includes("/")) return undefined;
  const folder = folders[bundleOf(tableKey)];
  if (folder) return `file://${encodeURI(joinPath(folder, "tables", tableNameOf(tableKey), "attachments", fileName))}`;
  return fixtureAttachmentUrls[tableKey]?.[fileName];
}

/**
 * Which attachments the Mac draws as an image: what a browser draws, and
 * HEIC and TIFF too, which NSImage reads (SVG through the patched decoder).
 */
export function canDrawOnMac(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|heic|tiff?)$/i.test(fileName);
}
