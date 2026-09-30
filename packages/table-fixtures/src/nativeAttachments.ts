// The fixtures' attachments for a React Native app (macOS, iOS, Android):
// each file bundled as a Metro asset, found with require.context as the web
// finds them with Vite's import.meta.glob (apps/web/src/loadFixture.ts), and
// resolved to the URL an image is drawn from. Keys look like
// ./crm.table/tables/companies/attachments/co-atlas.svg.

import { Image } from "react-native";

const fixtureFiles = (
  require as unknown as {
    context: (dir: string, deep: boolean, match: RegExp) => { keys(): string[]; (key: string): number };
  }
).context("../../../fixtures", true, /\/attachments\/[^/]+$/);

/** Each fixture table's attachments, by `bundle/table` key, then file name. */
export const fixtureAttachmentUrls: Record<string, Record<string, string>> = {};
for (const key of fixtureFiles.keys()) {
  const m = /^\.\/([^/]+)\.table\/tables\/([^/]+)\/attachments\/(.+)$/.exec(key);
  if (!m) continue;
  const uri = Image.resolveAssetSource(fixtureFiles(key))?.uri;
  if (uri) (fixtureAttachmentUrls[`${m[1]}/${m[2]}`] ??= {})[m[3]!] = withoutDotSegments(uri);
}

/** A fixture table's attachment file names, by its `bundle/table` key, sorted. */
export function fixtureAttachments(tableKey: string): string[] {
  return Object.keys(fixtureAttachmentUrls[tableKey] ?? {}).sort();
}

/**
 * The fixtures sit outside each app's folder, so Metro names their assets
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
