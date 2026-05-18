/**
 * Inline copy of the canonical `fixtures/projects.table/` for consumers
 * that can't load arbitrary non-JS files from outside their package.
 *
 * Web (`apps/web`) loads the on-disk fixture directly via Vite's
 * `import.meta.glob`. Metro (mobile + desktop) has no equivalent
 * primitive, so they import THIS module instead. A future iteration
 * could codegen this file from the on-disk fixture at build time so
 * there's a single source of truth; for the spike, sync manually when
 * the on-disk version changes.
 */
import type { ParsedTable } from "@workspace/table-core";

export const projectsTable: ParsedTable = {
  path: "fixtures/projects.table",
  schema: {
    fields: [
      { name: "title", type: "string", constraints: { required: true } },
      {
        name: "status",
        type: "string",
        constraints: { enum: ["planning", "active", "on-hold", "done"] },
      },
      { name: "owner", type: "string" },
      { name: "budget", type: "number" },
      { name: "launched", type: "date" },
      { name: "summary", type: "string", format: "markdown" },
    ],
    primaryKey: ["title"],
    "schema-version": 1,
  },
  rows: [
    {
      id: "p1",
      title: "Workspace v1",
      status: "active",
      owner: "leslie",
      budget: 80000,
      launched: "2026-01-15",
      summary: "Local-first markdown app for information workers",
    },
    {
      id: "p2",
      title: "Table file format spike",
      status: "done",
      owner: "leslie",
      budget: 0,
      launched: "2026-04-20",
      summary: "Open .table format research",
    },
    {
      id: "p3",
      title: "iOS Pro launch",
      status: "planning",
      owner: "leslie",
      budget: 25000,
      summary: "Premium tier on the App Store",
    },
    {
      id: "p4",
      title: "Web companion app",
      status: "planning",
      owner: "claude",
      budget: 15000,
      summary: "Web read-only viewer",
    },
    {
      id: "p5",
      title: "Sync engine",
      status: "on-hold",
      owner: "claude",
      budget: 40000,
      summary: "P2P sync between devices",
    },
    {
      id: "p6",
      title: "Brand redesign",
      status: "done",
      owner: "sam",
      budget: 12000,
      launched: "2026-03-01",
      summary: "Visual identity refresh",
    },
    {
      id: "p7",
      title: "Docs site",
      status: "active",
      owner: "sam",
      budget: 5000,
      launched: "2026-04-01",
      summary: "Public-facing documentation",
    },
  ],
  views: [
    {
      id: "v1",
      name: "All projects",
      layout: "table",
      fields: ["title", "status", "owner", "launched"],
    },
    {
      id: "v2",
      name: "Active by owner",
      layout: "table",
      filter: [{ field: "status", operator: "eq", value: "active" }],
      sort: [{ field: "owner", direction: "asc" }],
    },
    {
      id: "v3",
      name: "Roadmap",
      layout: "table",
      fields: ["title", "status", "launched"],
      sort: [{ field: "launched", direction: "asc" }],
    },
    {
      id: "v4",
      name: "By owner",
      layout: "table",
      group: { field: "owner" },
    },
    {
      id: "v5",
      name: "Board by status",
      layout: "board",
      board_field: "status",
      fields: ["title", "owner", "budget"],
    },
    {
      id: "v6",
      name: "Gallery",
      layout: "gallery",
      gallery_field: "summary",
      fields: ["title", "owner", "status"],
    },
    {
      id: "v7",
      name: "Quick list",
      layout: "list",
      fields: ["title", "owner"],
    },
    {
      id: "v8",
      name: "Calendar",
      layout: "calendar",
      calendar_field: "launched",
    },
  ],
  bodies: {
    p2: "# Table file format spike\n\nOpen, app-agnostic data-matrix file format. Sits in the same niche as Airtable, Google Tables, and Obsidian Bases — a portable database that also reads as a spreadsheet for information workers.\n\n## Architecture\n\nA `.table/` is a directory: schema.json, rows.ndjson, views.json, meta.json, attachments/, bodies/{id}.md, index.sqlite.",
  },
  meta: {
    format: "table",
    formatVersion: 1,
    title: "Projects",
    generator: "table-file-format spike fixture",
  },
};
