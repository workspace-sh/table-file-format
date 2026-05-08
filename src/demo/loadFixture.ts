import projectsSchema from "../../fixtures/projects.table/schema.json" with { type: "json" };
import projectsViews from "../../fixtures/projects.table/views.json" with { type: "json" };
import projectsMeta from "../../fixtures/projects.table/meta.json" with { type: "json" };
import projectsRowsRaw from "../../fixtures/projects.table/rows.ndjson?raw";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "../core/types.js";

function parseNdjson(raw: string): Row[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

export const projectsTable: ParsedTable = {
  path: "fixtures/projects.table",
  schema: projectsSchema as TableSchema,
  rows: parseNdjson(projectsRowsRaw),
  views: projectsViews as View[],
  meta: projectsMeta as TableMeta,
};
