// Where each row of a table is, without drawing or holding any of them:
// every row is one height unless something says otherwise (a height of its
// own, a group's heading above it), so a row's top is a multiplication and
// a short search, whatever the table's size. The windowed lists scroll by
// this (LARGE-TABLES-PLAN, Phase A and B).

/** Something that moves the rows after a place: room above its row, more height for it, or both. */
export interface RowMark {
  place: number;
  /** Room above the row (a group's heading). */
  before?: number;
  /** How much taller the row is than the rest (shorter, when negative). */
  taller?: number;
}

export interface RowLayout {
  count: number;
  /** All the rows, top to bottom. */
  height: number;
  /** A row's own top, past any room above it. */
  topOf(place: number): number;
  /** The top of the room above a row: its top, when it has none. */
  itemTop(place: number): number;
  /** A row's own height. */
  heightOf(place: number): number;
  /** The row at `y`: the first whose bottom is past it. `count` when `y` is past them all. */
  at(y: number): number;
}

export function rowLayout(count: number, rowHeight: number, marks: readonly RowMark[] = []): RowLayout {
  // One entry per marked place, in order.
  const sorted = [...marks].filter((m) => m.place >= 0 && m.place < count).sort((a, b) => a.place - b.place);
  const places: number[] = [];
  const before: number[] = [];
  const taller: number[] = [];
  for (const m of sorted) {
    if (places[places.length - 1] === m.place) {
      before[before.length - 1]! += m.before ?? 0;
      taller[taller.length - 1]! += m.taller ?? 0;
    } else {
      places.push(m.place);
      before.push(m.before ?? 0);
      taller.push(m.taller ?? 0);
    }
  }
  // sums[k]: everything the marks before the k-th add.
  const sums = new Float64Array(places.length + 1);
  for (let k = 0; k < places.length; k++) sums[k + 1] = sums[k]! + before[k]! + taller[k]!;
  /** The first mark at or after `place`. */
  const markFrom = (place: number) => {
    let lo = 0;
    let hi = places.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (places[mid]! < place) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const itemTop = (place: number) => place * rowHeight + sums[markFrom(place)]!;
  const topOf = (place: number) => {
    const k = markFrom(place);
    return place * rowHeight + sums[k]! + (places[k] === place ? before[k]! : 0);
  };
  const heightOf = (place: number) => {
    const k = markFrom(place);
    return rowHeight + (places[k] === place ? taller[k]! : 0);
  };
  return {
    count,
    height: count === 0 ? 0 : itemTop(count),
    topOf,
    itemTop,
    heightOf,
    at(y) {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (topOf(mid) + heightOf(mid) <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}
