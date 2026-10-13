// A view drawn inside something else that scrolls (a table in a document):
// it is as tall as what it shows, up to a limit, and scrolls within itself
// past that; and it has no margin of its own, since where it sits has one.

import { createContext, useContext } from "react";

export interface Embedded {
  /** The tallest the view is, in pixels. Past it, it scrolls within itself. */
  maxHeight: number;
}

export const EmbeddedContext = createContext<Embedded | null>(null);

/** Set when the view is drawn inside something else that scrolls; null in a window of its own. */
export function useEmbedded(): Embedded | null {
  return useContext(EmbeddedContext);
}

/**
 * A view's scroller: filling its window, or, embedded, as tall as what it
 * holds up to the limit.
 */
export function scrollerHeight(embedded: Embedded | null): { vexpand: boolean; propagateNaturalHeight: boolean; maxContentHeight: number } {
  return embedded ? { vexpand: false, propagateNaturalHeight: true, maxContentHeight: embedded.maxHeight } : { vexpand: true, propagateNaturalHeight: false, maxContentHeight: -1 };
}

/** A card view's margins from its window's edges; none when embedded, where it sits has its own. */
export function viewMargins(embedded: Embedded | null): { marginStart: number; marginEnd: number; marginTop: number; marginBottom: number } {
  return embedded ? { marginStart: 0, marginEnd: 0, marginTop: 0, marginBottom: 0 } : { marginStart: 12, marginEnd: 12, marginTop: 6, marginBottom: 12 };
}
