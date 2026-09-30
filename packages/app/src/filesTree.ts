// The Files side of the sidebar, as plain data: each .table file (a
// bundle) as it is on disk, the folders and files the writer writes
// (core's bundleFiles) plus attachments, each with its kind and what
// opening it shows. The web, macOS and Linux each draw it; what's folded
// or opened is theirs to say, so it comes in as input.

import { bundleFiles, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";

import { tableKeysIn, toBundle } from "./bundles.ts";

/** What a file of a `.table` is. */
export type BundleFileKind = "manifest" | "schema" | "rows" | "views" | "meta" | "body" | "attachment";

export interface FilesTreeFile {
  name: string;
  /** Its path inside `<bundle>.table/`: `tables/deals/rows.ndjson`. */
  path: string;
  kind: BundleFileKind;
  /** Opening it shows its text as saving writes it, or an attachment's bytes. */
  opens: "text" | "attachment";
  /** What it holds, in a word: `6 rows`, `9 fields`, `4 views`. */
  note?: string;
}

export interface FilesTreeDir {
  name: string;
  /** Its path inside `<bundle>.table/`, without a trailing slash: `tables/deals`. */
  path: string;
  /** Whether its entries are listed. */
  open: boolean;
  /** How many files it holds, for `bodies/` and `attachments/`, which start folded. */
  count?: number;
  /** The table it's part of, as a `bundle/table` key, for anything under `tables/<name>/`. */
  tableKey?: string;
  files: FilesTreeFile[];
  dirs: FilesTreeDir[];
}

export interface FilesTreeBundle {
  bundle: string;
  /** The folder's name: `crm.table/`. */
  name: string;
  folded: boolean;
  /** Its top folder: meta.json and tables/. */
  root: FilesTreeDir;
}

export interface FilesTreeOptions {
  /** Bundles folded away. */
  folded?: Iterable<string>;
  /** The table on screen: its folder starts open, other tables' folded. */
  activeTable?: string;
  /**
   * Folders the viewer opened or closed, by `bundle/path`
   * (`crm/tables/deals/bodies`); the rest follow the defaults above.
   */
  opened?: Record<string, boolean>;
  /** A table's attachment file names, by its `bundle/table` key. */
  attachmentsOf?: (tableKey: string) => string[];
}

export function filesTree(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  options: FilesTreeOptions = {},
): FilesTreeBundle[] {
  const folded = new Set(options.folded ?? []);
  const opened = options.opened ?? {};
  return Object.keys(bundles).map((bundle) => {
    const paths = bundleFiles(toBundle(tables, bundles, bundle)).map((f) => f.path);
    for (const key of tableKeysIn(tables, bundles, bundle)) {
      const name = key.slice(bundle.length + 1);
      for (const file of options.attachmentsOf?.(key) ?? []) paths.push(`tables/${name}/attachments/${file}`);
    }
    const root: FilesTreeDir = { name: "", path: "", open: true, files: [], dirs: [] };
    for (const path of paths) {
      const parts = path.split("/");
      let dir = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const at = parts.slice(0, i + 1).join("/");
        let next = dir.dirs.find((d) => d.path === at);
        if (!next) {
          next = { name: parts[i]!, path: at, open: false, files: [], dirs: [] };
          if (parts[0] === "tables" && i >= 1) next.tableKey = `${bundle}/${parts[1]}`;
          next.open = opened[`${bundle}/${at}`] ?? openByDefault(next, bundle, options.activeTable);
          dir.dirs.push(next);
        }
        dir = next;
      }
      const kind = fileKind(path);
      const table = dir.tableKey ? tables[dir.tableKey] : undefined;
      const note = table ? noteFor(kind, table) : undefined;
      dir.files.push({
        name: parts[parts.length - 1]!,
        path,
        kind,
        opens: kind === "attachment" ? "attachment" : "text",
        ...(note ? { note } : {}),
      });
    }
    countFiles(root);
    return { bundle, name: `${bundle}.table/`, folded: folded.has(bundle), root };
  });
}

/** What a path inside a `.table` is, by where the writer puts it. */
export function fileKind(path: string): BundleFileKind {
  if (path === "meta.json") return "manifest";
  if (/^tables\/[^/]+\/attachments\//.test(path)) return "attachment";
  if (/^tables\/[^/]+\/bodies\//.test(path)) return "body";
  if (path.endsWith("/schema.json")) return "schema";
  if (path.endsWith("/rows.ndjson")) return "rows";
  if (path.endsWith("/views.json")) return "views";
  return "meta";
}

/** An attachment's table (`bundle/table`) and file name, or null for any other file. */
export function attachmentAt(bundle: string, path: string): { tableKey: string; name: string } | null {
  const m = /^tables\/([^/]+)\/attachments\/(.+)$/.exec(path);
  return m ? { tableKey: `${bundle}/${m[1]}`, name: m[2]! } : null;
}

/** A file's text as saving writes it, or undefined when there's no such text file. */
export function fileText(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  bundle: string,
  path: string,
): string | undefined {
  return bundleFiles(toBundle(tables, bundles, bundle)).find((f) => f.path === path)?.content;
}

/** One line of the tree, for a UI that draws it as a flat list (GTK's ListBox). */
export type FilesTreeEntry =
  | { kind: "bundle"; bundle: FilesTreeBundle }
  | { kind: "dir"; bundle: string; dir: FilesTreeDir; depth: number }
  | { kind: "file"; bundle: string; file: FilesTreeFile; depth: number };

/** What's showing: folded bundles and closed folders list nothing under them. */
export function flattenFilesTree(tree: FilesTreeBundle[]): FilesTreeEntry[] {
  const entries = (bundle: string, dir: FilesTreeDir, depth: number): FilesTreeEntry[] => [
    ...dir.files.map((file): FilesTreeEntry => ({ kind: "file", bundle, file, depth })),
    ...dir.dirs.flatMap((d): FilesTreeEntry[] => [
      { kind: "dir", bundle, dir: d, depth },
      ...(d.open ? entries(bundle, d, depth + 1) : []),
    ]),
  ];
  return tree.flatMap((b): FilesTreeEntry[] => [{ kind: "bundle", bundle: b }, ...(b.folded ? [] : entries(b.bundle, b.root, 1))]);
}

// bodies/ and attachments/ always start folded, and a table's folder is
// open only when it's the table on screen: the tree opens on what you're
// looking at.
function openByDefault(dir: FilesTreeDir, bundle: string, activeTable: string | undefined): boolean {
  if (dir.name === "bodies" || dir.name === "attachments") return false;
  if (dir.path.startsWith("tables/") && dir.path.split("/").length === 2) return `${bundle}/${dir.name}` === activeTable;
  return true;
}

function noteFor(kind: BundleFileKind, table: ParsedTable): string | undefined {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (kind === "rows") return plural(table.rows.length, "row");
  if (kind === "schema") return plural(table.schema.fields.length, "field");
  if (kind === "views") return plural(table.views.length, "view");
  return undefined;
}

function countFiles(dir: FilesTreeDir): void {
  if (dir.name === "bodies" || dir.name === "attachments") dir.count = dir.files.length;
  dir.dirs.forEach(countFiles);
}
