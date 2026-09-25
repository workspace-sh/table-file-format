/**
 * Inline copy of the canonical `fixtures/tasks.table/` — see the header
 * of `projects.ts` for why this duplicate exists (Metro can't load
 * arbitrary non-JS files the way Vite's `import.meta.glob` can).
 *
 * IMPORTANT: edits to `fixtures/tasks.table/{rows.ndjson,schema.json}`
 * must be mirrored here, otherwise mobile + desktop ship stale data
 * while the web demo shows the new content.
 *
 * Note the `project` field's relation back to `projects` — the demos
 * key their table map as `{ projects, tasks }` so this `table: "projects"`
 * reference resolves on every platform.
 */
import type { ParsedTable } from "@workspace.sh/table-core";

export const tasksTable: ParsedTable = {
  path: "fixtures/tasks.table",
  schema: {
    fields: [
      { name: "title", type: "string", constraints: { required: true } },
      {
        name: "project",
        type: "string",
        relation: { table: "projects", field: "id" },
      },
      {
        name: "status",
        type: "string",
        constraints: { enum: ["todo", "doing", "done"] },
      },
      {
        name: "priority",
        type: "integer",
        constraints: { minimum: 1, maximum: 5 },
      },
      { name: "assignee", type: "string" },
    ],
    primaryKey: ["title"],
    "schema-version": 1,
  },
  rows: [
    { id: "t1", title: "Land .table extension", project: "p2", status: "done", priority: 1, assignee: "leslie" },
    { id: "t2", title: "Wire RSD + StyleX", project: "p2", status: "doing", priority: 2, assignee: "leslie" },
    { id: "t3", title: "Fixtures + tests", project: "p2", status: "doing", priority: 3, assignee: "claude" },
    { id: "t4", title: "Settings panel", project: "p1", status: "todo", priority: 2, assignee: "leslie" },
    { id: "t5", title: "Markdown editor polish", project: "p1", status: "doing", priority: 1, assignee: "sam" },
    { id: "t6", title: "App icon", project: "p3", status: "todo", priority: 3, assignee: "sam" },
    { id: "t7", title: "Sync conflict resolution", project: "p5", status: "todo", priority: 4, assignee: "claude" },
    { id: "t8", title: "OG images", project: "p7", status: "done", priority: 5, assignee: "sam" },
  ],
  views: [
    {
      id: "v1",
      name: "All tasks by priority",
      layout: "table",
      sort: [{ field: "priority", direction: "asc" }],
    },
    {
      id: "v2",
      name: "Board by status",
      layout: "board",
      board_field: "status",
    },
  ],
  meta: {
    format: "table",
    formatVersion: 1,
    title: "Tasks",
    generator: "table-file-format spike fixture",
  },
};
