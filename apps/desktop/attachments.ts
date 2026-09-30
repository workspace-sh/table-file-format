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
  if (uri) (fixtureUrls[`${m[1]}/${m[2]}`] ??= {})[m[3]!] = withoutDotSegments(uri);
}

/**
 * The fixtures sit outside this app's folder, so Metro names their assets
 * `/assets/../../fixtures/…`. Metro serves the collapsed path, but a fetch
 * (react-native-svg's) sends the dots as they are and gets a 404. Collapse
 * them, as a browser would.
 */
function withoutDotSegments(uri: string): string {
  const m = /^([a-z]+:\/\/[^/]+)([^?#]*)(.*)$/i.exec(uri);
  if (!m) return uri;
  const out: string[] = [];
  for (const part of m[2]!.split("/").filter((p) => p !== "")) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return `${m[1]}/${out.join("/")}${m[3]}`;
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

/** A fixture table's attachment file names, by its `bundle/table` key, sorted. */
export function fixtureAttachments(tableKey: string): string[] {
  return Object.keys(fixtureUrls[tableKey] ?? {}).sort();
}

/**
 * Which attachments the Mac draws as an image: what a browser draws, and
 * HEIC and TIFF too, which NSImage reads (SVG through the patched decoder).
 */
export function canDrawOnMac(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|heic|tiff?)$/i.test(fileName);
}
