// A Sheet view's merged cells (SPEC section 4, D58): which of the view's
// `merged` blocks can be drawn as one, and where, in the columns and rows
// as they're shown.

import type { View } from "./types.js";

/** A block drawn as one: its first column and row as shown, how many of each, and the cell whose value it shows. */
export interface MergedBlock {
  column: number;
  columns: number;
  row: number;
  rows: number;
  /** The top-left cell, whose value the block shows. */
  field: string;
  rowId: string;
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
  for (const merge of view.merged) {
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
    blocks.push({ column, columns: width, row, rows: height, field: columns[column]!, rowId: rows[row]! });
  }
  return blocks;
}
