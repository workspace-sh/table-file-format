import { Fragment, useImperativeHandle, type ReactNode, type Ref } from "react";

/** What a row list can be asked to do from outside. */
export interface RowListHandle {
  /** Bring the item at `index` into view, if it isn't. */
  scrollIndexIntoView(index: number): void;
  /**
   * The list's top in the window, now: an item's own top is this plus the
   * heights before it, drawn or not. Null where every row is drawn, and a
   * row's place is measured from the row.
   */
  top(): number | null;
}

export interface RowListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The item's height, known before it's drawn: nothing is measured. */
  sizeOf: (item: T, index: number) => number;
  render: (item: T, index: number) => ReactNode;
  /** Changes whenever a height or a drawn row could have, without the items changing. */
  version?: string;
  /** Whether an item is drawn above its neighbours: what hangs below it (the row grip) isn't covered by the next. */
  raised?: (item: T) => boolean;
  handle?: Ref<RowListHandle>;
}

/**
 * A table's rows, one after another. Here every row is drawn; the web's
 * variant (RowList.web.tsx) draws only the rows on screen. Native gets its
 * own when the phone reads large tables (LARGE-TABLES-PLAN, I1).
 */
export function RowList<T>({ items, keyOf, render, handle }: RowListProps<T>) {
  useImperativeHandle(handle, () => ({ scrollIndexIntoView: () => {}, top: () => null }), []);
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={keyOf(item)}>{render(item, i)}</Fragment>
      ))}
    </>
  );
}
