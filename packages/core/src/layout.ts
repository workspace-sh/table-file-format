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
//   │       ├── rows/             TableEntry.rowsDir (D51; formatVersion 1: rows.ndjson, TableEntry.rows)
//   │       │   └── 0001.ndjson
//   │       ├── views.json        TableEntry.views
//   │       ├── meta.json         TableEntry.meta
//   │       ├── history.ndjson    TableEntry.history
//   │       ├── attachments/      TableEntry.attachments
//   │       └── bodies/           TableEntry.bodies
//   │           └── {title}--{row.id}.md   bodyFileName
//   └── index.sqlite              BundleEntry.index

/** What a bundle's folder name ends in: `crm.table`. */
export const BUNDLE_EXTENSION = ".table";

/** What a bundle packed into one file ends in: `crm.table.zip`. */
export const ARCHIVE_EXTENSION = ".table.zip";

/** What a row's page ends in, under a table's `bodies/`: `{title}--{row.id}.md`. */
export const BODY_EXTENSION = ".md";

/** What parts a page's title from its row's id in its file name (D64). A title written there never holds it. */
export const BODY_ID_SEPARATOR = "--";

/** The longest a title in a page's file name gets, in characters: enough to tell pages apart, short enough for any file system. */
const BODY_TITLE_LENGTH = 40;

/**
 * A title as a page's file name holds it (D64): lowercase (case-insensitive
 * file systems), its letters and digits in any script, everything else a
 * single `-`, cut at 40 characters. Empty when nothing of it is left.
 */
export function bodyTitleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return [...slug].slice(0, BODY_TITLE_LENGTH).join("").replace(/-+$/, "");
}

/**
 * A row's page's file name (D64): `atlas-freight--{id}.md`, so a person
 * browsing `bodies/` sees which row each page is; just `{id}.md` when the
 * row has no title. The id is what the page belongs to, the title only a
 * reading aid: a reader never trusts it (rowIdOfBodyFile).
 */
export function bodyFileName(rowId: string, title?: string): string {
  const slug = title ? bodyTitleSlug(title) : "";
  // An id holding the separator itself is always written after one, so it reads back whole.
  if (!slug && !rowId.includes(BODY_ID_SEPARATOR)) return `${rowId}${BODY_EXTENSION}`;
  return `${slug}${BODY_ID_SEPARATOR}${rowId}${BODY_EXTENSION}`;
}

/** The row a page's file name is for: what follows its first `--`, else the whole name; null when it isn't a page (`.md`). */
export function rowIdOfBodyFile(fileName: string): string | null {
  if (!fileName.endsWith(BODY_EXTENSION) || fileName.includes("/")) return null;
  const stem = fileName.slice(0, -BODY_EXTENSION.length);
  const at = stem.indexOf(BODY_ID_SEPARATOR);
  const id = at === -1 ? stem : stem.slice(at + BODY_ID_SEPARATOR.length);
  return id.length > 0 ? id : null;
}

/** A row's title, as its page's file name holds it: its first text field with a value, as a person would name the row. */
export function rowTitleIn(fields: readonly { name: string; type: string }[], row: Record<string, unknown>): string | undefined {
  for (const field of fields) {
    if (field.type !== "string") continue;
    const v = row[field.name];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

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
  /** Its rows, one JSON object a line, in files in order (section 3, D51). Required. */
  rowsDir: "rows",
  /** Where `formatVersion` 1 kept its rows, in one file: still read. */
  rows: "rows.ndjson",
  /** Its views (section 4). Optional. */
  views: "views.json",
  /** Its own title and description. Optional. */
  meta: "meta.json",
  /** Its edit history (section 14). Optional. */
  history: "history.ndjson",
  /** Files its rows point at. Optional. */
  attachments: "attachments",
  /** Its rows' pages, `{title}--{row.id}.md` each (D64). Optional. */
  bodies: "bodies",
} as const;
export type TableEntry = (typeof TableEntry)[keyof typeof TableEntry];

/** The files a directory under `tables/` must have to be a table. */
export const REQUIRED_TABLE_FILES: readonly TableEntry[] = [TableEntry.schema, TableEntry.rowsDir];

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

/** A row's page within its bundle: `tables/companies/bodies/{title}--{id}.md`. */
export function bodyPath(name: string, rowId: string, title?: string): string {
  return `${tableEntryPath(name, TableEntry.bodies)}/${bodyFileName(rowId, title)}`;
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
  if (parts[0] === "" || parts[1] !== BundleEntry.tables || !parts[2]) return false;
  // `<name>.table/tables/<t>/rows/0001.ndjson`, or formatVersion 1's `<name>.table/tables/<t>/rows.ndjson`.
  if (parts.length === 5) return parts[3] === TableEntry.rowsDir && /^\d{4,}[a-z]*\.ndjson$/.test(parts[4]!);
  return parts.length === 4 && parts[3] === TableEntry.rows;
}

