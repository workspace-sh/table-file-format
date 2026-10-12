/**
 * A table's rows as the screen's own scrolling list (listPage.ts). Native
 * builds take PageList.native.tsx (LegendList); a browser has no use for
 * it, so this draws nothing and the table is drawn as before.
 */
import type { ReactNode, Ref } from "react";

export interface PageListHandle {
  /** Bring the item at `index` into the middle of the screen. */
  scrollIndexIntoView(index: number): void;
  /** The first row's top in the window, now: a row's own top is this plus the heights before it (RowListHandle.top). */
  top(): number | null;
}

export interface PageListProps {
  /** How many rows; items are their places, 0 to count - 1. */
  count: number;
  keyOf: (place: number) => string;
  /** A row's height, known before it's drawn. */
  sizeOf: (place: number) => number;
  /** A row, as wide as the table. */
  renderRow: (place: number) => ReactNode;
  /** What's above the table: it doesn't move sideways. */
  header: ReactNode;
  /** The table's header row, and under its rows the new-row band and totals: these move sideways with the rows. */
  tableHeader: ReactNode;
  footer: ReactNode;
  /** The table's width with the page's margins either side: how far it scrolls sideways. */
  contentWidth: number;
  /** Where a sideways scroll may come to rest: each column's start. */
  snapTo?: readonly number[];
  /** Changes when anything the rows draw from changes, so the rows on screen are drawn again. */
  extraData: unknown;
  /** The first and last places on screen, as they change. */
  onShown?: (first: number, last: number) => void;
  handle?: Ref<PageListHandle | null>;
  /** The screen's scroll view's props. */
  scrollProps: Record<string, unknown>;
  onScroller?: (scroller: unknown) => void;
}

export function PageList(_props: PageListProps): ReactNode {
  return null;
}
