// A table's rows files (SPEC section 3, D51) as an index keeps them: where
// each file starts among the index's rows, so a save writes each row back to
// the file it came from, and a file past the limit is split. Linux's index
// (nodeIndex.ts) and iOS and the Mac's (indexHost.ts) both save through this.

import { FIRST_ROWS_FILE, nameAfter, nameBetween, ROWS_FILE_BYTES, type SqlDriver } from "@workspace.sh/table-core";

/** A rows file, and the place its first row takes in the index (places run from 1, in file order). */
export interface RowFileStart {
  name: string;
  first: number;
}

const TABLE = "create table if not exists _rowfiles(tbl text not null, name text not null, first integer not null, primary key(tbl, name))";

/** Where table `name`'s rows files start, in file order; none when the index hasn't said (one file, 0001). */
export async function rowFileStarts(db: SqlDriver, name: string): Promise<RowFileStart[]> {
  // Only read: a save asks this inside a read transaction of its own.
  if ((await db.all("select 1 from sqlite_master where type = 'table' and name = '_rowfiles'")).length === 0) return [];
  return (await db.all("select name, first from _rowfiles where tbl = ? order by first, name", [name])).map((r) => ({ name: r.name as string, first: r.first as number }));
}

/** Say where table `name`'s rows files start, replacing what was said. */
export async function setRowFileStarts(db: SqlDriver, name: string, files: RowFileStart[]): Promise<void> {
  await db.exec(TABLE);
  await db.run("delete from _rowfiles where tbl = ?", [name]);
  for (const f of files) await db.run("insert into _rowfiles(tbl, name, first) values(?, ?, ?)", [name, f.name, f.first]);
}

/**
 * Which file each of a table's rows goes in, asked a row at a time in the
 * index's order: the file whose first row is at or before it, or, once the
 * file being written has passed `limit` bytes, a new one (by number after
 * the last file, by letters before the next). `place` gives the file's name
 * when the row starts one, and null when it goes on the one before;
 * `files` is where each file written starts.
 */
export function rowFilePlacer(
  starts: RowFileStart[],
  limit: number = ROWS_FILE_BYTES,
): { place(pos: number, bytes: number): string | null; files: RowFileStart[] } {
  const bounds = starts.length > 0 ? starts : [{ name: FIRST_ROWS_FILE, first: -Infinity }];
  const files: RowFileStart[] = [];
  let at = -1;
  let size = 0;
  const start = (name: string, pos: number) => {
    files.push({ name, first: pos });
    size = 0;
    return name;
  };
  return {
    files,
    place(pos, bytes) {
      let k = at < 0 ? 0 : at;
      while (k + 1 < bounds.length && bounds[k + 1]!.first <= pos) k++;
      let opened: string | null = null;
      if (k !== at) {
        at = k;
        opened = start(bounds[k]!.name, pos);
      } else if (size >= limit) {
        // Past the limit: the next file, by number after the last file, by letters before another.
        const current = files[files.length - 1]!.name;
        opened = start(k === bounds.length - 1 ? nameAfter(current) : nameBetween(current, bounds[k + 1]!.name), pos);
      }
      size += bytes;
      return opened;
    },
  };
}
