// The names the format gives its files and folders (SPEC section 1), in
// one place: what a bundle is called on disk, what is in it, and what is
// in each of its tables. The reader, the writer, the archive and every
// app take them from here, so a name that the spec changes is changed
// here and nowhere else.
//
//   crm.table/                    BUNDLE_EXTENSION
//   ├── meta.json                 BundleEntry.meta
//   ├── tables/                   BundleEntry.tables
//   │   └── companies/
//   │       ├── schema.json       TableEntry.schema
//   │       ├── rows.ndjson       TableEntry.rows
//   │       ├── views.json        TableEntry.views
//   │       ├── meta.json         TableEntry.meta
//   │       ├── history.ndjson    TableEntry.history
//   │       ├── attachments/      TableEntry.attachments
//   │       └── bodies/           TableEntry.bodies
//   │           └── {row.id}.md   BODY_EXTENSION
//   └── index.sqlite              BundleEntry.index

/** What a bundle's folder name ends in: `crm.table`. */
export const BUNDLE_EXTENSION = ".table";

/** What a bundle packed into one file ends in: `crm.table.zip`. */
export const ARCHIVE_EXTENSION = ".table.zip";

/** What a row's page ends in, under a table's `bodies/`: `{row.id}.md`. */
export const BODY_EXTENSION = ".md";

/** What is in a bundle's folder. */
export const BundleEntry = {
  /** The bundle's manifest (section 5). Optional. */
  meta: "meta.json",
  /** One directory per table. Required. */
  tables: "tables",
  /** A rebuildable cache for the bundle (section 8). Optional, and never the truth. */
  index: "index.sqlite",
} as const;
export type BundleEntry = (typeof BundleEntry)[keyof typeof BundleEntry];

/** What is in a table's directory, `tables/<name>/`. */
export const TableEntry = {
  /** Its fields (section 2). Required. */
  schema: "schema.json",
  /** Its rows, one JSON object a line (section 3). Required. */
  rows: "rows.ndjson",
  /** Its views (section 4). Optional. */
  views: "views.json",
  /** Its own title and description. Optional. */
  meta: "meta.json",
  /** Its edit history (section 14). Optional. */
  history: "history.ndjson",
  /** Files its rows point at. Optional. */
  attachments: "attachments",
  /** Its rows' pages, `{row.id}.md` each. Optional. */
  bodies: "bodies",
} as const;
export type TableEntry = (typeof TableEntry)[keyof typeof TableEntry];

/** The files a directory under `tables/` must have to be a table. */
export const REQUIRED_TABLE_FILES: readonly TableEntry[] = [TableEntry.schema, TableEntry.rows];

/** A bundle's folder or archive name without what it ends in: `crm` for `crm.table` and for `crm.table.zip`. */
export function bundleNameOf(fileName: string): string {
  if (fileName.endsWith(ARCHIVE_EXTENSION)) return fileName.slice(0, -ARCHIVE_EXTENSION.length);
  return fileName.endsWith(BUNDLE_EXTENSION) ? fileName.slice(0, -BUNDLE_EXTENSION.length) : fileName;
}

/** A table's directory within its bundle, `/`-separated: `tables/companies`. */
export function tablePath(name: string): string {
  return `${BundleEntry.tables}/${name}`;
}

/** One of a table's files or folders within its bundle: `tables/companies/rows.ndjson`. */
export function tableEntryPath(name: string, entry: TableEntry): string {
  return `${tablePath(name)}/${entry}`;
}

/** A row's page within its bundle: `tables/companies/bodies/{id}.md`. */
export function bodyPath(name: string, rowId: string): string {
  return `${tableEntryPath(name, TableEntry.bodies)}/${rowId}${BODY_EXTENSION}`;
}

/** The table a path inside a bundle belongs to (`tables/companies/…`), or null when it is under no table. */
export function tableNameIn(path: string): string | null {
  const prefix = `${BundleEntry.tables}/`;
  if (!path.startsWith(prefix)) return null;
  const end = path.indexOf("/", prefix.length);
  return end > prefix.length ? path.slice(prefix.length, end) : null;
}

/** Whether a path inside an archive (`crm.table/tables/companies/rows.ndjson`) is a table's rows file. */
export function isArchivedRowsFile(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] !== "" && parts[1] === BundleEntry.tables && parts[2] !== "" && parts[3] === TableEntry.rows;
}

