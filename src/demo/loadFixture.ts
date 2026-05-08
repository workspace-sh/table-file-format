import projectsSchema from "../../fixtures/projects.table/schema.json" with { type: "json" };
import projectsViews from "../../fixtures/projects.table/views.json" with { type: "json" };
import projectsMeta from "../../fixtures/projects.table/meta.json" with { type: "json" };
import projectsRowsRaw from "../../fixtures/projects.table/rows.ndjson?raw";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "../core/types.js";

const projectsBodyFiles = import.meta.glob<string>(
  "../../fixtures/projects.table/bodies/*.md",
  { eager: true, query: "?raw", import: "default" },
);

function parseNdjson(raw: string): Row[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

function bodiesByRowId(files: Record<string, string>): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const filename = path.split("/").pop() ?? "";
    const id = filename.replace(/\.md$/, "");
    if (id) bodies[id] = content;
  }
  return bodies;
}

export const projectsTable: ParsedTable = {
  path: "fixtures/projects.table",
  schema: projectsSchema as TableSchema,
  rows: parseNdjson(projectsRowsRaw),
  views: projectsViews as View[],
  meta: projectsMeta as TableMeta,
  bodies: bodiesByRowId(projectsBodyFiles),
};
