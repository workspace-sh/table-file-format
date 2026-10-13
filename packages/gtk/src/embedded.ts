// A view drawn inside something else that scrolls (a table in a document):
// it is as tall as what it shows, up to a limit, and scrolls within itself
// past that; and it has no margin of its own, since where it sits has one.

import * as Gtk from "@gtkx/gi/gtk";
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from "react";

export interface Embedded {
  /** The tallest the view is, in pixels. Past it, it scrolls within itself. */
  maxHeight: number;
  /** A table or a list shows this many rows, then scrolls: its height is theirs, whatever `maxHeight` is. */
  rows?: number;
  /** A board shows this many cards down each column, a gallery the lines that hold this many; then they scroll. */
  cards?: number;
}

export const EmbeddedContext = createContext<Embedded | null>(null);

/** Set when the view is drawn inside something else that scrolls; null in a window of its own. */
export function useEmbedded(): Embedded | null {
  return useContext(EmbeddedContext);
}

/**
 * A view's scroller: filling its window, or, embedded, as tall as what it
 * holds up to the limit. `until`: where the last row or card it was asked
 * to show ends, which is then the limit.
 */
export function scrollerHeight(embedded: Embedded | null, until: number | null = null): { vexpand: boolean; propagateNaturalHeight: boolean; maxContentHeight: number } {
  return embedded
    ? { vexpand: false, propagateNaturalHeight: true, maxContentHeight: until ?? embedded.maxHeight }
    : { vexpand: true, propagateNaturalHeight: false, maxContentHeight: -1 };
}

/** How far down `within` a widget ends, once they are laid out. */
export function bottomIn(widget: Gtk.Widget, within: Gtk.Widget): number | undefined {
  const [known, bounds] = widget.computeBounds(within);
  const bottom = known ? bounds.getY() + bounds.getHeight() : 0;
  return bottom > 0 ? bottom : undefined;
}

/** A widget's child by its place, from 0. */
export function childAt(widget: Gtk.Widget, place: number): Gtk.Widget | null {
  let child = widget.getFirstChild();
  for (let i = 0; i < place && child; i++) child = child.getNextSibling();
  return child;
}

/**
 * The scroller of a view whose rows or cards are as tall as they turn out
 * to be (a list, a board, a gallery), embedded and asked to show so many of
 * them. `until` says where the last of those ends, measured on screen:
 * null when the view has no more than were asked for (it shows them all),
 * undefined while it isn't laid out yet. Asked again whenever the view is
 * drawn and whenever what it holds changes height.
 */
export function useEmbeddedScroller(
  embedded: Embedded | null,
  until: (() => number | null | undefined) | null,
): { ref: RefObject<Gtk.ScrolledWindow | null>; vexpand: boolean; propagateNaturalHeight: boolean; maxContentHeight: number } {
  const ref = useRef<Gtk.ScrolledWindow | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const asked = embedded !== null && until !== null;
  const fit = () => {
    if (!asked) return setLimit(null);
    const end = until();
    if (end !== undefined) setLimit(end === null ? null : Math.ceil(end));
  };
  const latest = useRef(fit);
  latest.current = fit;
  useEffect(() => latest.current());
  useEffect(() => {
    const down = ref.current?.getVadjustment();
    if (!down) return;
    const changed = () => latest.current();
    down.on("changed", changed);
    return () => {
      down.off("changed", changed);
    };
  }, []);
  return { ref, ...scrollerHeight(embedded, asked ? limit : null) };
}

/** A card view's margins from its window's edges; none when embedded, where it sits has its own. */
export function viewMargins(embedded: Embedded | null): { marginStart: number; marginEnd: number; marginTop: number; marginBottom: number } {
  return embedded ? { marginStart: 0, marginEnd: 0, marginTop: 0, marginBottom: 0 } : { marginStart: 12, marginEnd: 12, marginTop: 6, marginBottom: 12 };
}
