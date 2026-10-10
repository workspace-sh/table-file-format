// The page's own vertical scroller, for a list inside it that draws only
// the rows on screen. A browser's list finds the element that scrolls it
// and listens to it; a native list can't, so the app that owns the
// screen's scroll view says where it is through this (PageScrollContext),
// and every list in the page follows the same numbers: a table's two panes
// then show the same rows side by side.

import { createContext } from "react";

export interface PageScroll {
  /** How far down the page is scrolled, and how tall the part of it on screen is. */
  now(): { offset: number; height: number };
  /**
   * Told when the page is scrolled ("scroll"), and when its size or the
   * size of what's in it changes ("resize": things in it may have moved).
   * Returns the way to stop.
   */
  subscribe(listener: (what: "scroll" | "resize") => void): () => void;
  /** Scroll the page by this much (positive: further down). */
  scrollBy(dy: number): void;
  /** A view's top within what the page scrolls, whatever is scrolled now; null when it can't be measured. */
  topOf(view: unknown): Promise<number | null>;
  /** The scrolled content's top in the window, now: a view's top in the window is this plus `topOf` it. */
  windowTop(): number;
}

export const PageScrollContext = createContext<PageScroll | null>(null);

interface ScrollerLike {
  scrollTo(to: { y: number; animated?: boolean }): void;
  getInnerViewRef?(): unknown;
}

interface MeasurableLike {
  measureLayout?(relativeTo: unknown, done: (x: number, y: number) => void, failed?: () => void): void;
}

/**
 * A PageScroll over a React Native ScrollView, and what to give that
 * ScrollView so it stays true: `onScroll`, `onLayout` and
 * `onContentSizeChange`. `scroller` is a ref to it. Made once per screen.
 */
export function pageScrollOver(scroller: { current: ScrollerLike | null }) {
  const listeners = new Set<(what: "scroll" | "resize") => void>();
  const at = { offset: 0, height: 0, top: 0 };
  const tell = (what: "scroll" | "resize") => listeners.forEach((listener) => listener(what));
  const pageScroll: PageScroll = {
    now: () => ({ offset: at.offset, height: at.height }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    scrollBy: (dy) => scroller.current?.scrollTo({ y: Math.max(0, at.offset + dy), animated: false }),
    topOf: (view) =>
      new Promise((done) => {
        const inner = scroller.current?.getInnerViewRef?.();
        const measurable = view as MeasurableLike | null;
        if (!inner || typeof measurable?.measureLayout !== "function") return done(null);
        measurable.measureLayout(
          inner,
          (_x, y) => done(y),
          () => done(null),
        );
      }),
    windowTop: () => at.top - at.offset,
  };
  return {
    pageScroll,
    /** The ScrollView's top in the window: where its content starts when nothing is scrolled. */
    setWindowTop: (top: number) => {
      at.top = top;
    },
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      at.offset = e.nativeEvent.contentOffset.y;
      tell("scroll");
    },
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => {
      at.height = e.nativeEvent.layout.height;
      tell("resize");
    },
    onContentSizeChange: () => tell("resize"),
  };
}
