import type { ParsedTable } from "@workspace.sh/table-core";
import { projectsTable } from "./projects";
import { tasksTable } from "./tasks";

export { projectsTable } from "./projects";
export { tasksTable } from "./tasks";

/**
 * Workspace of available tables, keyed by the same string a relation
 * uses in its `table` declaration. Tasks reference projects via
 * `"relation": { "table": "projects", "field": "id" }`, so the key
 * here is the bare `projects` (NOT `fixtures/projects.table`). Mirrors
 * the shape `apps/web/src/loadFixture.ts` builds so all three demos
 * resolve relations identically.
 */
export const tables: Record<string, ParsedTable> = {
  projects: projectsTable,
  tasks: tasksTable,
};
