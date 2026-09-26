// Moving between cards from the keyboard, for the views that show rows as
// cards. Pure: which card an arrow key leads to, given where the cards are.

/**
 * Cards in columns: a board's columns, or a list as one column. Up and down
 * stay in the column; left and right go to the next column that has cards,
 * at the same position or its last card. Unknown keys and edges stay put.
 */
export function moveInColumns(columns: readonly (readonly string[])[], id: string, key: string): string {
  const c = columns.findIndex((col) => col.includes(id));
  if (c < 0) return id;
  const col = columns[c]!;
  const i = col.indexOf(id);
  switch (key) {
    case "ArrowUp":
      return col[Math.max(0, i - 1)]!;
    case "ArrowDown":
      return col[Math.min(col.length - 1, i + 1)]!;
    case "Home":
      return col[0]!;
    case "End":
      return col[col.length - 1]!;
    case "ArrowLeft":
    case "ArrowRight": {
      const step = key === "ArrowLeft" ? -1 : 1;
      for (let n = c + step; n >= 0 && n < columns.length; n += step) {
        const next = columns[n]!;
        if (next.length > 0) return next[Math.min(i, next.length - 1)]!;
      }
      return id;
    }
    default:
      return id;
  }
}

/**
 * Cards in rows of `perRow`, read left to right (a gallery). Left and right
 * step one card, wrapping between rows; up and down step a row.
 */
export function moveInGrid(ids: readonly string[], perRow: number, id: string, key: string): string {
  const i = ids.indexOf(id);
  if (i < 0) return id;
  const across = Math.max(1, perRow);
  const to = (n: number) => ids[Math.max(0, Math.min(ids.length - 1, n))]!;
  switch (key) {
    case "ArrowLeft":
      return to(i - 1);
    case "ArrowRight":
      return to(i + 1);
    case "ArrowUp":
      return i - across >= 0 ? ids[i - across]! : id;
    case "ArrowDown":
      return i + across < ids.length ? ids[i + across]! : id;
    case "Home":
      return ids[0]!;
    case "End":
      return ids[ids.length - 1]!;
    default:
      return id;
  }
}

/** `ids` with `id` moved one place up or down, for a view's `order`. */
export function nudge(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const out = [...ids];
  const i = out.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
