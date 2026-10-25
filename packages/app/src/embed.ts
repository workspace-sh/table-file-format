// A `.table` drawn inside something else: a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). What
// the link's address names in a file just read: which table and which
// view, or why it can't be drawn, in words for whoever is reading the
// document. Every platform's drop-in (table-gtk's and table-ui's
// TableEmbed) asks this, so a link draws the same thing, and fails with
// the same words, everywhere. `./react`'s useEmbeddedTable holds what it
// names; readEmbedWith finds the file over a platform's TableFs (`./node`'s
// readEmbed is it over the disk, as Node sees it).

import { formatAddress, parseAddress, type Address, type BundleMeta, type EditEvent, type ParsedTable, type Row, type TableSchema, type View } from "@workspace.sh/table-core";
import { joinPath, type ReadOptions, type TableFs } from "@workspace.sh/table-core/io";
import { boardColumns } from "@workspace.sh/table-ui/shared";

import { addressTarget, bundleOf, otherFilesNamed, tableNameOf } from "./bundles.ts";
import { settled, writesNoted } from "./heldFiles.ts";
import { appendFolderHistory } from "./editHistory.ts";
import { openLibrary, writeLibraryBundle, type Library } from "./library.ts";

/**
 * How much of the view is shown before it scrolls within itself, from the
 * link's address (SPEC section 10): `rows=` for a table or a list, `cards=`
 * for a board (down each column) or a gallery. Absent: the drop-in's own
 * limit.
 */
export interface EmbedSize {
  rows?: number;
  cards?: number;
  /**
   * What becomes of the rows or cards past the count: absent, the view
   * scrolls within itself to them; "more" (`rest=more`), only the counted
   * ones are drawn, with a line beneath that says how many more there are
   * and shows them.
   */
  rest?: "more";
  /**
   * A table's width (`width=full`): its columns share the whole width it's
   * given, rather than stopping at their natural widths (the default).
   */
  width?: "full";
}

/** The most rows or cards an address can ask to be shown at once. */
export const EMBED_COUNT_MAX = 500;

/** A whole number from 1, as an address writes it; anything else is not a count. */
function count(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d{0,5}$/.test(value)) return undefined;
  return Math.min(Number(value), EMBED_COUNT_MAX);
}

/** What an address says of how much to show. A value that isn't a count is ignored, as an unknown key is. */
export function embedSize(address: Pick<Address, "extra">): EmbedSize {
  const rows = count(address.extra?.rows);
  const cards = count(address.extra?.cards);
  return {
    ...(rows === undefined ? {} : { rows }), ...(cards === undefined ? {} : { cards }), ...(address.extra?.rest === "more" ? { rest: "more" as const } : {}),
    ...(address.extra?.width === "full" ? { width: "full" as const } : {}),
  };
}

/** Which of an address's counts a view's layout shows: rows for a table or a list, cards for a board or a gallery. */
export function embedCount(size: EmbedSize, layout: View["layout"]): number | undefined {
  if (layout === "table" || layout === "list") return size.rows;
  if (layout === "board" || layout === "gallery") return size.cards;
  return undefined;
}

/**
 * How many of a view's rows or cards an embed asked for only the first of
 * (`rest=more`) leaves out: what its "Show 12 more rows" line counts. A
 * board leaves out the cards past the count in each column. 0 when it
 * isn't cut, or leaves nothing out.
 */
export function embedLeftOut(size: EmbedSize, view: View, rows: Row[], schema: TableSchema): number {
  const shown = size.rest === "more" ? embedCount(size, view.layout) : undefined;
  if (shown === undefined) return 0;
  if (view.layout !== "board") return Math.max(0, rows.length - shown);
  const board = boardColumns(view, rows, schema);
  return board.keys.reduce((left, key) => left + Math.max(0, (board.groups[key]?.length ?? 0) - shown), 0);
}

/** The line beneath a cut embed, which shows the rest when pressed: "Show 12 more rows". */
export function embedMoreText(leftOut: number, layout: View["layout"]): string {
  const what = layout === "board" || layout === "gallery" ? "card" : "row";
  return `Show ${leftOut.toLocaleString("en")} more ${what}${leftOut === 1 ? "" : "s"}`;
}

export interface EmbedShown {
  kind: "shown";
  /** The file as read: its tables by `bundle/table` key, and where it is, for writing it back. */
  library: Library;
  /** The table to draw, by its key in `library.tables`. */
  key: string;
  /** Its view's id; "" for a table with no views of its own. */
  viewId: string;
  /** How much of it to show at once, when the address says. */
  size: EmbedSize;
}

export interface EmbedProblem {
  kind: "problem";
  text: string;
}

export type EmbedRead = EmbedShown | EmbedProblem;

export const embedProblem = (text: string): EmbedProblem => ({ kind: "problem", text });

const listed = (names: string[]) => names.map((n) => `“${n}”`).join(", ");

/**
 * What `address` names in `library`, one `.table` file just read (its
 * large tables without their rows: `indexed`). `file` is what the file is
 * called, for the words.
 */
export function embedIn(library: Library, address: Pick<Address, "tableName" | "viewId" | "extra">, file: string, options: { readsIndex?: boolean } = {}): EmbedRead {
  const keys = Object.keys(library.tables);
  if (keys.length === 0) {
    const why = Object.values(library.problems).flat()[0];
    return embedProblem(why ? `“${file}” couldn’t be read: ${why}` : `“${file}” isn’t a .table, or it holds no tables.`);
  }
  const bundle = bundleOf(keys[0]!);
  const names = keys.map(tableNameOf);

  // `table=` may be left out when the bundle holds exactly one (SPEC section 1).
  const name = address.tableName ?? (names.length === 1 ? names[0]! : undefined);
  if (name === undefined) return embedProblem(`“${file}” holds ${names.length} tables. The link says which with “table=”: ${listed(names)}.`);
  const key = keys.find((k) => tableNameOf(k) === name && bundleOf(k) === bundle);
  const table = key === undefined ? undefined : library.tables[key];
  if (key === undefined || !table) return embedProblem(`“${file}” has no table named “${name}”. It has ${listed(names)}.`);
  // A table of many rows is read through an index, in an app of its own (SPEC section 8).
  // A drop-in that reads a large table through its index (readsIndex) draws it; one that can't says so.
  if (table.indexed && !options.readsIndex) return embedProblem(`“${name}” in “${file}” has too many rows to show in a document yet.`);

  if (address.viewId !== undefined && !table.views.some((v) => v.id === address.viewId)) {
    const has = table.views.length > 0 ? ` It has ${listed(table.views.map((v) => v.id))}.` : " It has no views of its own.";
    return embedProblem(`The table “${name}” has no view “${address.viewId}”.${has}`);
  }
  return { kind: "shown", library, key, viewId: address.viewId ?? table.views[0]?.id ?? "", size: embedSize(address) };
}

/** Where an embedded table's file is, for the platform: how a bundle is written back, and how its history is added to. */
export interface EmbeddedTableFiles {
  /** Write one bundle of `tables` to where `library` read it from. */
  write: (library: Library, tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>, bundle: string) => Promise<void>;
  /** Append events to the history of the table `key` (SPEC section 14). Absent: the platform keeps no history. */
  appendHistory?: (library: Library, key: string, events: EditEvent[]) => Promise<void>;
}

/** The tallest an embedded view is before it scrolls within itself, as on GTK. */
export const EMBED_MAX_HEIGHT = 480;

/** A row's height and the header's, for how tall `rows=n` is: table-ui's own default. */
export const EMBED_ROW_HEIGHT = 44;

/**
 * The line under an embedded table, with its caption or Open, and the gap
 * above it: about this tall, as measured on macOS (13 pt text).
 */
export const EMBED_FOOT_HEIGHT = 22;

/**
 * The room an embed is likely to take, from its link alone, before its file
 * is read: exact for a table's `rows=n` (a header and n rows of `rowHeight`),
 * else the limit. Null when the link names no table.
 */
export function embedRoom(address: string | undefined, maxHeight: number, rowHeight: number): number | null {
  const parsed = address === undefined ? null : parseAddress(address);
  if (!parsed) return null;
  const rows = embedSize(parsed).rows;
  return rows === undefined ? maxHeight : Math.min(maxHeight, rowHeight + rows * rowHeight);
}

/**
 * The room a document keeps for a `TableEmbed` before the embed has drawn,
 * from its link alone: the room it keeps while its file is read
 * (`embedRoom`), and the line under it when it will have one (a `caption`, or
 * Open, which a host that gives `onOpen` offers). Reserved from the document's
 * first layout, so the text after an embed doesn't move down once the embed
 * has measured. Null when the link can't be read as an address.
 */
export function tableEmbedRoom(address: string, { caption = false, open = false }: { caption?: boolean; open?: boolean } = {}): number | null {
  const room = embedRoom(address, EMBED_MAX_HEIGHT, EMBED_ROW_HEIGHT);
  return room === null ? null : room + (caption || open ? EMBED_FOOT_HEIGHT : 0);
}

/** A document's link to a `.table`, and where it can be read from. */
export interface EmbedTarget {
  /** The link's destination as written: `../tables/projects.table#table=tasks&view=v2&embed=1`. */
  address: string;
  /** The folder the address is relative to: the document's. */
  baseDir: string;
  /**
   * The folder the file has to be inside, links followed: what the reader
   * opened. A document can name any path; this is what keeps it to theirs.
   * Absent: anywhere.
   */
  within?: string;
}

/** How a platform reads a linked file, beyond its TableFs. */
export interface EmbedReading {
  /** Which of a file's tables keep their rows elsewhere (an index), as the platform's reader decides. */
  rowsElsewhere?: ReadOptions["rowsElsewhere"];
  /** A path with its symbolic links followed, where the platform can; the folder check is then of where it really is. */
  real?: (path: string) => string | Promise<string>;
  /** The drop-in reads a large table (one with its rows elsewhere) through its index: it is drawn, not refused. */
  readsIndex?: boolean;
}

/** A path as a link writes it: percent-encoded where Markdown needs it. */
function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * `path` from `base`, `.` and `..` worked out, `/`-separated: as
 * `path.resolve` does, for any platform. A base that's a URL (`file:///…`,
 * as expo-file-system speaks) keeps its scheme.
 */
export function resolvePath(base: string, path: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(base)?.[0] ?? "";
  const from = base.slice(scheme.length);
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${from}/${path}`).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${scheme}/${parts.join("/")}`;
}

/** Whether `path` is inside `folder` (not the folder itself). Both are absolute and worked out. */
function insidePath(path: string, folder: string): boolean {
  const root = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(root) && path.length > root.length;
}

const lastPart = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * What a document's link to a `.table` names, read for drawing in place
 * over a platform's TableFs: the file as an app holds it, with which
 * table and view (embedIn), or why it can't be drawn. The same reading,
 * and the same words, on every platform.
 */
export function readEmbedWith(fs: TableFs, target: EmbedTarget, reading: EmbedReading = {}): Promise<EmbedRead> {
  return readEmbedFrom(fs, target, reading, (path) => readLinked(fs, path, reading));
}

/** A file an embed names, with the files its relations name beside it (withOtherFiles). */
async function readLinked(fs: TableFs, path: string, reading: EmbedReading): Promise<Library> {
  const library = await openLibrary(fs, [path], [], reading.rowsElsewhere ? { rowsElsewhere: reading.rowsElsewhere } : {});
  return withOtherFiles(fs, library, reading);
}

/**
 * A document's embeds read as one: each file once, however many embeds name
 * it, rather than once for each. A document of six embeds of one file read
 * it six times over, all at once, on the one thread the page is drawn from;
 * and the first table waited for all of them. The embeds of a file are then
 * handed the same Library, which none of them changes: each keeps its own
 * state, and an edit in one reaches the others through heldFiles.
 *
 * A file is read again once anything has been written since it was read, so
 * an embed drawn after an edit draws the edit. Make one for each document
 * shown, so that opening it again reads it from the disk.
 */
export function embedReaderWith(fs: TableFs, reading: EmbedReading = {}): (target: EmbedTarget) => Promise<EmbedRead> {
  const read = new Map<string, { writes: number; library: Promise<Library> }>();
  const open = (path: string): Promise<Library> => {
    const held = read.get(path);
    if (held && held.writes === writesNoted()) return held.library;
    const library = readLinked(fs, path, reading);
    const entry = { writes: writesNoted(), library };
    read.set(path, entry);
    // A read that failed is tried again by the next embed, not handed on.
    library.catch(() => {
      if (read.get(path) === entry) read.delete(path);
    });
    return library;
  };
  return (target) => readEmbedFrom(fs, target, reading, open);
}

async function readEmbedFrom(fs: TableFs, { address, baseDir, within }: EmbedTarget, reading: EmbedReading, open: (path: string) => Promise<Library>): Promise<EmbedRead> {
  const parsed = parseAddress(address);
  if (!parsed) return embedProblem("This link doesn’t name a table.");
  const written = decoded(parsed.tablePath);
  const path = resolvePath(baseDir, written);
  if (within !== undefined) {
    const real = reading.real ?? ((p: string) => p);
    if (!insidePath(await real(path), resolvePath(await real(within), "."))) {
      return embedProblem(`“${written}” is outside the folder that’s open, so it isn’t shown.`);
    }
  }
  if ((await fs.list(path)) === null) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const entry = (await fs.list(parent))?.find((e) => e.name === lastPart(path));
    return embedProblem(entry ? `“${lastPart(path)}” isn’t a .table.` : `There’s no table at “${written}”.`);
  }
  // After any write of it another view has under way.
  await settled(path);
  return embedIn(await open(path), parsed, lastPart(path), { readsIndex: reading.readsIndex === true });
}

/** An embedded table's files over a platform's TableFs: edits written where the file was read from, and each to its table's history. */
export function embedFilesWith(fs: TableFs): EmbeddedTableFiles {
  return {
    write: (library, tables, metas, bundle) => writeLibraryBundle(fs, library, tables, metas, bundle),
    appendHistory: (library, key, events) => appendFolderHistory(fs, joinPath(library.paths[bundleOf(key)]!, "tables", tableNameOf(key)), events),
  };
}

/**
 * A linked row clicked in a `.table` a drop-in draws (an embed, or a file
 * opened as a document), as an address an app can open: the `.table`'s path
 * as it was read, the table, and the row (`/notes/projects.table#table=projects&row=p2`).
 * The cell's own address names the row's table as the file does (`projects#row=p2`),
 * which means nothing outside it. Null when the table isn't one this file
 * holds (a link to another `.table`, not followed from here yet), or the file
 * has no path (read from a single-file `.table`).
 */
export function linkedRowAddress(address: string, library: Library, held: { tables: Record<string, ParsedTable>; bundles: Record<string, BundleMeta> }, fromBundle: string): string | null {
  const target = addressTarget(address, held.tables, held.bundles, fromBundle);
  const path = target ? library.paths[bundleOf(target.key)] : undefined;
  if (!target || path === undefined) return null;
  const rowId = parseAddress(address)?.rowId;
  return formatAddress({ tablePath: path, tableName: tableNameOf(target.key), ...(target.viewId ? { viewId: target.viewId } : {}), ...(rowId ? { rowId } : {}) });
}

/**
 * Where an embed's table is, as an address an app can open the file at: the
 * `.table`'s path as it was read, and the table and view drawn
 * (`/notes/projects.table#table=tasks&view=v2`). Null for a file read from a
 * single-file `.table`, which has no path.
 */
export function embedFileAddress(shown: EmbedShown, viewId: string = shown.viewId): string | null {
  const path = shown.library.paths[bundleOf(shown.key)];
  if (path === undefined) return null;
  return formatAddress({ tablePath: path, tableName: tableNameOf(shown.key), ...(viewId ? { viewId } : {}) });
}

/**
 * A file just read, with the `.table` files its relations name beside it
 * (SPEC section 2): read too, so a linked row there shows its name and can
 * be opened, and lookups through it reach it. Only those beside it, one step:
 * their own relations to further files are not followed. A file that isn't
 * there is a dangling relation, as before.
 */
export async function withOtherFiles(fs: TableFs, library: Library, reading: Pick<EmbedReading, "rowsElsewhere"> = {}): Promise<Library> {
  const paths: string[] = [];
  for (const [bundle, path] of Object.entries(library.paths)) {
    const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    for (const name of otherFilesNamed(library.tables, bundle)) {
      const other = joinPath(folder, `${name}.table`);
      if (!paths.includes(other) && !Object.values(library.paths).includes(other) && (await fs.list(other)) !== null) paths.push(other);
    }
  }
  if (paths.length === 0) return library;
  const others = await openLibrary(fs, paths, Object.keys(library.bundles), reading.rowsElsewhere ? { rowsElsewhere: reading.rowsElsewhere } : {});
  return {
    tables: { ...library.tables, ...others.tables },
    bundles: { ...library.bundles, ...others.bundles },
    paths: { ...library.paths, ...others.paths },
    problems: { ...library.problems, ...others.problems },
  };
}
