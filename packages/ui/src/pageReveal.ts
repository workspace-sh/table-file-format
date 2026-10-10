// Where a page scrolls natively (the Mac's pane, a phone's screen), the
// table can't scroll it itself: an app that wraps a view in a scroll of its
// own gives this, and the table asks it to bring a rect into view (keyboard
// selection, a cell opened off screen). The rect is in the window's
// coordinates, as measureAnchor gives them. The web doesn't need it: the
// browser scrolls an element into view itself.

import { createContext } from "react";

export type PageRevealRect = { top: number; left: number; width: number; height: number };
export const PageReveal = createContext<((rect: PageRevealRect) => void) | null>(null);
