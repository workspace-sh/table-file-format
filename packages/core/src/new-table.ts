import { newId } from "./id.js";
import { TABLE_FORMAT_VERSION, type ParsedTable } from "./types.js";

/**
 * A new, empty table: one text field (`title`), one table view, no rows.
 * What an app starts from when someone makes a table from scratch; the
 * rest (fields, formulas, rows, views) is built up from there.
 *
 * `path` is the `.table/` directory the app will write it to. `now` is
 * injectable so tests are deterministic.
 */
export function newTable(title: string, path: string, now: Date = new Date()): ParsedTable {
  const stamp = now.toISOString();
  return {
    path,
    schema: {
      fields: [{ name: "title", type: "string" }],
      "schema-version": 1,
    },
    rows: [],
    views: [{ id: newId(), name: "All", layout: "table" }],
    meta: {
      format: "table",
      formatVersion: TABLE_FORMAT_VERSION,
      title,
      created_at: stamp,
      modified_at: stamp,
    },
  };
}
