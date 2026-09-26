// Every fixture in fixtures/, found by globbing, so adding one needs no
// change here. Each is a bundle (D37); its tables go into the demo's one
// map under `bundle/table` keys, and its manifest beside them.

import type { BundleMeta, ParsedTable, Row, TableMeta, TableSchema, View } from "@workspace.sh/table-core";

type Json<T> = Record<string, T>;
const manifests = import.meta.glob<BundleMeta>("../../../fixtures/*.table/meta.json", { eager: true, import: "default" });
const schemas = import.meta.glob<TableSchema>("../../../fixtures/*.table/tables/*/schema.json", { eager: true, import: "default" });
const viewFiles = import.meta.glob<View[]>("../../../fixtures/*.table/tables/*/views.json", { eager: true, import: "default" });
const metaFiles = import.meta.glob<TableMeta>("../../../fixtures/*.table/tables/*/meta.json", { eager: true, import: "default" });
const rowFiles = import.meta.glob<string>("../../../fixtures/*.table/tables/*/rows.ndjson", { eager: true, query: "?raw", import: "default" });
const bodyFiles = import.meta.glob<string>("../../../fixtures/*.table/tables/*/bodies/*.md", { eager: true, query: "?raw", import: "default" });
// Attachments stay files (SPEC section 6): the demo only needs somewhere to show them from.
const attachmentFiles = import.meta.glob<string>("../../../fixtures/*.table/tables/*/attachments/*", { eager: true, query: "?url", import: "default" });

/** "../../../fixtures/crm.table/meta.json" → "crm" */
function bundleKeyOf(path: string): string {
  return /fixtures\/([^/]+)\.table\//.exec(path)![1]!;
}

/** "../../../fixtures/crm.table/tables/deals/schema.json" → "crm/deals" */
function tableKeyOf(path: string): string {
  const m = /fixtures\/([^/]+)\.table\/tables\/([^/]+)\//.exec(path)!;
  return `${m[1]}/${m[2]}`;
}

function byTableKey<T>(files: Json<T>): Record<string, T> {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [tableKeyOf(path), value]));
}

function parseNdjson(raw: string): Row[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

const views = byTableKey(viewFiles);
const metas = byTableKey(metaFiles);
const rows = byTableKey(rowFiles);
const bodies: Record<string, Record<string, string>> = {};
for (const [path, content] of Object.entries(bodyFiles)) {
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  (bodies[tableKeyOf(path)] ??= {})[id] = content;
}

/** Each fixture bundle's manifest, by the bundle's name. */
export const bundles: Record<string, BundleMeta> = Object.fromEntries(
  Object.entries(manifests)
    .map(([path, meta]) => [bundleKeyOf(path), meta] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
);

/**
 * Every fixture table, keyed `bundle/table`. Relations name a table by
 * its name alone and resolve within its own bundle (D37); see bundles.ts.
 */
export const tables: Record<string, ParsedTable> = Object.fromEntries(
  Object.entries(byTableKey(schemas))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, schema]) => [
      key,
      {
        path: `fixtures/${key.replace("/", ".table/tables/")}`,
        schema,
        rows: parseNdjson(rows[key] ?? ""),
        views: views[key] ?? [],
        meta: metas[key] ?? {},
        ...(bodies[key] ? { bodies: bodies[key] } : {}),
      },
    ]),
);

/** Each fixture table's attachments, by filename: a URL the demo can show them from. */
export const attachmentUrls: Record<string, Record<string, string>> = {};
for (const [path, url] of Object.entries(attachmentFiles)) {
  (attachmentUrls[tableKeyOf(path)] ??= {})[path.split("/").pop()!] = url;
}
