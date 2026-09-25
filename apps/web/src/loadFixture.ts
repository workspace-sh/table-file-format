import projectsSchema from "../../../fixtures/projects.table/schema.json" with { type: "json" };
import projectsViews from "../../../fixtures/projects.table/views.json" with { type: "json" };
import projectsMeta from "../../../fixtures/projects.table/meta.json" with { type: "json" };
import projectsRowsRaw from "../../../fixtures/projects.table/rows.ndjson?raw";
import tasksSchema from "../../../fixtures/tasks.table/schema.json" with { type: "json" };
import tasksViews from "../../../fixtures/tasks.table/views.json" with { type: "json" };
import tasksMeta from "../../../fixtures/tasks.table/meta.json" with { type: "json" };
import tasksRowsRaw from "../../../fixtures/tasks.table/rows.ndjson?raw";
import type {
  ParsedTable,
  Row,
  TableMeta,
  TableSchema,
  View,
} from "@workspace.sh/table-core";

const projectsBodyFiles = import.meta.glob<string>(
  "../../../fixtures/projects.table/bodies/*.md",
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

export const tasksTable: ParsedTable = {
  path: "fixtures/tasks.table",
  schema: tasksSchema as TableSchema,
  rows: parseNdjson(tasksRowsRaw),
  views: tasksViews as View[],
  meta: tasksMeta as TableMeta,
};

/**
 * Workspace of available tables, keyed by the same string a relation
 * uses in its `table` declaration. Tasks reference projects via
 * `"relation": { "table": "projects", "field": "id" }`, so the key
 * here is the bare `projects` (NOT `fixtures/projects.table`). Apps
 * with a real filesystem would key by the resolved path; the web
 * demo keeps it short.
 */
export const tables: Record<string, ParsedTable> = {
  projects: projectsTable,
  tasks: tasksTable,
};
