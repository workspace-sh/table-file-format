// A screen whose scroll view is the table's own list (LegendList on iOS,
// #490). The app gives the table what the page shows above it and how the
// screen's scroll view is set up; the table then scrolls the whole screen
// itself, drawing only the rows on screen, instead of being drawn inside the
// app's scroll view. Without one, the table is drawn as before.

import { createContext, type ReactNode } from "react";

export interface ListPage {
  /** What the page shows above the table: its place, count and notes. */
  header: ReactNode;
  /** The screen's scroll view's props (insets, keyboard, scroll events, padding under the last row). */
  scrollProps: Record<string, unknown>;
  /** Told the scroll view it now scrolls with, for an app that scrolls it itself (scrollTo). */
  onScroller?: (scroller: unknown) => void;
}

export const ListPageContext = createContext<ListPage | null>(null);
