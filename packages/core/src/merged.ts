// A Sheet view's merged cells (SPEC section 4, D58): which of the view's
// `merged` blocks can be drawn as one, and where, in the columns and rows
// as they're shown.

import type { View, ViewMerge } from "./types.js";

/** A block drawn as one: its first column and row as shown, how many of each, and the cell whose value it shows. */
export interface MergedBlock {
  column: number;
  columns: number;
  row: number;
  rows: number;
  /** The top-left cell, whose value the block shows. */
  field: string;
  rowId: string;
  /** Which of the view's `merged` it is. */
  index: number;
}

/**
 * The view's merges that can be drawn, over `columns` (the fields shown,
 * in order) and `rows` (the row ids shown, in order). A block is drawn
 * when its corners are both shown, it is more than one cell, the rows
 * between its corners are the ones the sheet's grid has between them
 * (`grid`, the grid's order: a reader's own sort or search that pulls
 * them apart leaves the cells as they are), and it doesn't overlap one
 * drawn before it. Its corners may be given either way round. `split`,
 * where columns stop staying put and start to scroll: a block across it
 * isn't drawn, as a spreadsheet won't merge frozen and scrolling cells.
 */
export function mergedBlocks(
  view: Pick<View, "merged" | "coordinates">,
  columns: readonly string[],
  rows: readonly string[],
  grid: readonly string[] = rows,
  split = 0,
): MergedBlock[] {
  if (view.coordinates !== true || !view.merged?.length) return [];
  const columnAt = new Map(columns.map((name, i) => [name, i]));
  const rowAt = new Map(rows.map((id, i) => [id, i]));
  const gridAt = new Map(grid.map((id, i) => [id, i]));
  const taken = new Set<string>();
  const blocks: MergedBlock[] = [];
  for (const [index, merge] of view.merged.entries()) {
    const c1 = columnAt.get(merge.from?.field);
    const c2 = columnAt.get(merge.to?.field);
    const r1 = rowAt.get(merge.from?.row);
    const r2 = rowAt.get(merge.to?.row);
    if (c1 === undefined || c2 === undefined || r1 === undefined || r2 === undefined) continue;
    const column = Math.min(c1, c2);
    const row = Math.min(r1, r2);
    const width = Math.abs(c2 - c1) + 1;
    const height = Math.abs(r2 - r1) + 1;
    if (width * height < 2) continue;
    if (split > 0 && column < split && column + width > split) continue;
    // The same rows, next to each other, as the grid has them.
    const g1 = gridAt.get(rows[row]!);
    const g2 = gridAt.get(rows[row + height - 1]!);
    if (g1 === undefined || g2 === undefined || g2 - g1 !== height - 1) continue;
    let together = true;
    for (let i = 0; i < height && together; i++) together = gridAt.get(rows[row + i]!) === g1 + i;
    if (!together) continue;
    const cells: string[] = [];
    for (let r = row; r < row + height; r++) for (let c = column; c < column + width; c++) cells.push(`${r},${c}`);
    if (cells.some((cell) => taken.has(cell))) continue;
    for (const cell of cells) taken.add(cell);
    blocks.push({ column, columns: width, row, rows: height, field: columns[column]!, rowId: rows[row]!, index });
  }
  return blocks;
}

/** 0 for A, 26 for AA. */
function columnOfLetters(letters: string): number {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A block typed as a spreadsheet's range, `B2:C4` (a `$` is let be), as a
 * merge: its corners by field and row id, against a grid's `columns` and
 * `rows`. Null when it isn't two corners of that grid, or is one cell.
 */
export function mergeOfRange(text: string, columns: readonly string[], rows: readonly string[]): ViewMerge | null {
  const m = /^\s*\$?([A-Za-z]+)\$?(\d+)\s*:\s*\$?([A-Za-z]+)\$?(\d+)\s*$/.exec(text);
  if (!m) return null;
  const f1 = columns[columnOfLetters(m[1]!)];
  const f2 = columns[columnOfLetters(m[3]!)];
  const r1 = rows[Number(m[2]) - 1];
  const r2 = rows[Number(m[4]) - 1];
  if (f1 === undefined || f2 === undefined || r1 === undefined || r2 === undefined) return null;
  if (f1 === f2 && r1 === r2) return null;
  return { from: { field: f1, row: r1 }, to: { field: f2, row: r2 } };
}

/**
 * A view's `merged` with `merge` added (D58): the blocks it overlaps go,
 * as a spreadsheet's do, placed against `columns` and `rows` (the grid).
 */
export function withMerge(view: Pick<View, "merged" | "coordinates">, merge: ViewMerge, columns: readonly string[], rows: readonly string[]): ViewMerge[] {
  const [added] = mergedBlocks({ coordinates: true, merged: [merge] }, columns, rows);
  if (!added) return view.merged ?? [];
  const overlaps = new Set(
    mergedBlocks({ ...view, coordinates: true }, columns, rows)
      .filter((b) => b.column < added.column + added.columns && added.column < b.column + b.columns && b.row < added.row + added.rows && added.row < b.row + b.rows)
      .map((b) => b.index),
  );
  return [...(view.merged ?? []).filter((_, i) => !overlaps.has(i)), merge];
}

/** The view's merge drawn over a cell, by its place in `merged`; -1 when none is. */
export function mergeOver(view: Pick<View, "merged" | "coordinates">, field: string, rowId: string, columns: readonly string[], rows: readonly string[]): number {
  const c = columns.indexOf(field);
  const r = rows.indexOf(rowId);
  const block = mergedBlocks(view, columns, rows).find((b) => c >= b.column && c < b.column + b.columns && r >= b.row && r < b.row + b.rows);
  return block ? block.index : -1;
}
