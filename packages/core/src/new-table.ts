import { newId } from "./id.js";
import { TABLE_FORMAT_VERSION, type ParsedBundle, type ParsedTable } from "./types.js";

/**
 * A new, empty table: one text field (`title`), one table view, no rows.
 * What an app starts from when someone makes a table from scratch; the
 * rest (fields, formulas, rows, views) is built up from there.
 *
 * `path` is the table's directory, `tables/<name>/` inside its bundle.
 * `now` is injectable so tests are deterministic.
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
      title,
      created_at: stamp,
      modified_at: stamp,
    },
  };
}

/**
 * A new `.table` bundle holding one new table (D37): what an app makes
 * when someone starts a new file. `path` is the bundle's directory;
 * `tableName` is the first table's name, and its title is `title` too.
 */
export function newBundle(
  title: string,
  path: string,
  tableName: string,
  now: Date = new Date(),
): ParsedBundle {
  const stamp = now.toISOString();
  return {
    path,
    meta: {
      format: "table",
      formatVersion: TABLE_FORMAT_VERSION,
      title,
      tables: [tableName],
      created_at: stamp,
      modified_at: stamp,
    },
    tables: { [tableName]: newTable(title, `${path}/tables/${tableName}`, now) },
  };
}
