// Every fixture in fixtures/, found by globbing, so adding one needs no
// change here. Each becomes a ParsedTable keyed as a relation's `table`
// names it: the directory's name without `.table`.

import type { ParsedTable, Row, TableMeta, TableSchema, View } from "@workspace.sh/table-core";

type Json<T> = Record<string, T>;
const schemas = import.meta.glob<TableSchema>("../../../fixtures/*.table/schema.json", { eager: true, import: "default" });
const viewFiles = import.meta.glob<View[]>("../../../fixtures/*.table/views.json", { eager: true, import: "default" });
const metaFiles = import.meta.glob<TableMeta>("../../../fixtures/*.table/meta.json", { eager: true, import: "default" });
const rowFiles = import.meta.glob<string>("../../../fixtures/*.table/rows.ndjson", { eager: true, query: "?raw", import: "default" });
const bodyFiles = import.meta.glob<string>("../../../fixtures/*.table/bodies/*.md", { eager: true, query: "?raw", import: "default" });
// Attachments stay files (SPEC section 6): the demo only needs somewhere to show them from.
const attachmentFiles = import.meta.glob<string>("../../../fixtures/*.table/attachments/*", { eager: true, query: "?url", import: "default" });

/** "../../../fixtures/projects.table/schema.json" → "projects" */
function keyOf(path: string): string {
  return /fixtures\/([^/]+)\.table\//.exec(path)![1]!;
}

function byKey<T>(files: Json<T>): Record<string, T> {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [keyOf(path), value]));
}

function parseNdjson(raw: string): Row[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

const views = byKey(viewFiles);
const metas = byKey(metaFiles);
const rows = byKey(rowFiles);
const bodies: Record<string, Record<string, string>> = {};
for (const [path, content] of Object.entries(bodyFiles)) {
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  (bodies[keyOf(path)] ??= {})[id] = content;
}

/**
 * The demo's tables, keyed by the same string a relation uses in its
 * `table` declaration: tasks reference projects as `"table": "projects"`.
 * Apps with a real filesystem would key by the resolved path.
 */
export const tables: Record<string, ParsedTable> = Object.fromEntries(
  Object.entries(byKey(schemas))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, schema]) => [
      key,
      {
        path: `fixtures/${key}.table`,
        schema,
        rows: parseNdjson(rows[key] ?? ""),
        views: views[key] ?? [],
        meta: metas[key] ?? {},
        ...(bodies[key] ? { bodies: bodies[key] } : {}),
      },
    ]),
);

/** Each fixture's attachments, by filename: a URL the demo can show them from. */
export const attachmentUrls: Record<string, Record<string, string>> = {};
for (const [path, url] of Object.entries(attachmentFiles)) {
  (attachmentUrls[keyOf(path)] ??= {})[path.split("/").pop()!] = url;
}
