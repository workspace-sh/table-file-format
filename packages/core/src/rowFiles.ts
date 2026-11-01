// A table's rows as files in its `rows/` folder (SPEC section 3, D51):
// read in their names' order as one file order, a new file started once
// the one being written passes about 25 MB, files never rebalanced, and
// names that sort the same as bytes compare and as file browsers sort
// numbers by value: four digits for files added at the end, letters added
// for a file split in the middle (`0002m` between `0002` and `0003`).

import type { Row, UnreadLine } from "./types.js";

/** A table's rows folder, inside its directory. */
export const ROWS_DIR = "rows";
/** Where `formatVersion` 1 kept a table's rows: read as its only rows file, and replaced by `rows/` on writing. */
export const LEGACY_ROWS_FILE = "rows.ndjson";
/** About how large a rows file grows before a writer starts the next one (25 MB: well under git hosts' 50 MB warning). */
export const ROWS_FILE_BYTES = 25_000_000;
/** A table's first rows file, and a small table's only one. */
export const FIRST_ROWS_FILE = "0001.ndjson";

/** The rows of one file, by id, in order, as a reader found them: where each row is written back. */
export interface RowFile {
  name: string;
  ids: string[];
}

const NAME = /^(\d{4,})([a-z]*)\.ndjson$/;

/** Whether `name` is a rows file's name: four or more digits, any lowercase letters, `.ndjson`. */
export const isRowsFileName = (name: string): boolean => NAME.test(name);

/** Rows files' names in file order: as their bytes compare (all ASCII, so as strings do). */
export function rowsFileOrder(names: Iterable<string>): string[] {
  return [...names].filter(isRowsFileName).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The name of the file after `name` at the end of the table: its number plus one, no letters. */
export function nameAfter(name: string): string {
  const [, digits] = NAME.exec(name)!;
  return `${String(Number(digits) + 1).padStart(digits!.length, "0")}.ndjson`;
}

/**
 * Letters strictly between `lo` and `hi` (null: no upper bound), never
 * ending in `a`, so there's always room for another between: fractional
 * indexing over a to z.
 */
function lettersBetween(lo: string, hi: string | null): string {
  let out = "";
  let bounded = hi !== null;
  for (let i = 0; ; i++) {
    const l = i < lo.length ? lo.charCodeAt(i) - 97 : -1;
    const h = bounded && i < hi!.length ? hi!.charCodeAt(i) - 97 : 26;
    const m = Math.max(1, Math.floor((l + h) / 2));
    if (m > l && m < h) return out + String.fromCharCode(97 + m);
    // No letter fits strictly between here: keep the lower one and go on.
    const c = Math.max(l, 0);
    out += String.fromCharCode(97 + c);
    if (c !== h) bounded = false;
  }
}

/** A name for a file split from `before`, sorting after it and before `after` (null: the end of the table). */
export function nameBetween(before: string, after: string | null): string {
  const [, digits, letters] = NAME.exec(before)!;
  const next = after === null ? null : NAME.exec(after)!;
  // A following file of the same number bounds the letters; one of a later number doesn't.
  const hi = next && next[1] === digits ? next[2]! : null;
  return `${digits}${lettersBetween(letters!, hi)}.ndjson`;
}

/**
 * About how many rows `total` bytes of rows files hold, judged from the
 * first bytes of the first (`head`): its lines that hold something, as a
 * share of its bytes. Exact when `head` is all of them.
 */
export function estimateRows(total: number, head: Uint8Array): number {
  let lines = 0;
  let blank = true;
  for (let i = 0; i < head.length; i++) {
    const byte = head[i]!;
    if (byte === 10) {
      if (!blank) lines++;
      blank = true;
    } else if (byte !== 13 && byte !== 32 && byte !== 9) blank = false;
  }
  if (head.length >= total) return blank ? lines : lines + 1;
  return head.length === 0 ? 0 : Math.round((lines / head.length) * total);
}

/** How many bytes `text` takes as UTF-8, without encoding it. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      // A surrogate pair: one code point of four bytes.
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * A table's rows laid out as files: each row in the file it was read from
 * (`files`), a new row in the file of the row before it (the last file, at
 * the end), lines that couldn't be read where they were, and any file past
 * `limit` bytes split, by a number at the end of the table and by letters
 * in the middle. Files left without rows aren't in the result (a table
 * with none keeps one, empty). With no
 * `files` (a new table), the rows are laid out from `0001` on.
 */
export function layoutRows(
  rows: Row[],
  line: (row: Row) => string,
  options: { files?: RowFile[]; unread?: UnreadLine[]; limit?: number } = {},
): { name: string; text: string }[] {
  const files = options.files && options.files.length > 0 ? options.files : [{ name: FIRST_ROWS_FILE, ids: [] }];
  const limit = options.limit ?? ROWS_FILE_BYTES;
  const fileOf = new Map<string, number>();
  files.forEach((f, k) => f.ids.forEach((id) => fileOf.set(id, k)));

  // Each row's line, in its file; a row kept to file order, so a file's rows stay together.
  const groups: { id: string | null; text: string }[][] = files.map(() => []);
  let at = 0;
  for (const row of rows) {
    const k = fileOf.get(row.id);
    if (k !== undefined && k > at) at = k;
    groups[at]!.push({ id: row.id, text: line(row) });
  }
  // Lines that couldn't be read, after the row they followed (before every row: the first file's start;
  // after a row that's gone: the end).
  for (const u of options.unread ?? []) {
    if (u.after === null) {
      groups[0]!.unshift({ id: null, text: u.text });
      continue;
    }
    const k = groups.findIndex((g) => g.some((e) => e.id === u.after));
    if (k < 0) {
      const filled = [...groups].reverse().find((g) => g.length > 0) ?? groups[0]!;
      filled.push({ id: null, text: u.text });
      continue;
    }
    const lines = groups[k]!;
    lines.splice(lines.findIndex((e) => e.id === u.after) + 1, 0, { id: null, text: u.text });
  }

  const out: { name: string; text: string }[] = [];
  groups.forEach((lines, k) => {
    if (lines.length === 0) return;
    const last = k === groups.length - 1 || groups.slice(k + 1).every((g) => g.length === 0);
    const following = files.slice(k + 1).find((_, j) => groups[k + 1 + j]!.length > 0)?.name ?? null;
    let name = files[k]!.name;
    let text = "";
    let bytes = 0;
    for (const { text: l } of lines) {
      // Past the limit: the next file, by number at the end of the table, by letters before another file.
      if (bytes >= limit && text !== "") {
        out.push({ name, text });
        name = last ? nameAfter(name) : nameBetween(name, following);
        text = "";
        bytes = 0;
      }
      text += `${l}\n`;
      bytes += utf8Length(l) + 1;
    }
    out.push({ name, text });
  });
  // A table with no rows keeps one empty file: git keeps no empty folder, and a table needs its rows/.
  if (out.length === 0) out.push({ name: files[0]!.name, text: "" });
  return out;
}
