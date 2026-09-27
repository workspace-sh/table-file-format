/**
 * Web variant — Vite picks this. Metro picks `SnapHScroll.tsx`.
 *
 * CSS scroll-snap delivers the same UX as RN's `snapToInterval` —
 * `scroll-snap-type: x mandatory` on the scroller, each child gets
 * `scroll-snap-align: start`. Children are wrapped in a snap-point
 * shell rather than asking callers to apply the alignment style,
 * keeps the consumer's child markup unchanged.
 */
import { Children } from "react";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import { GutterSpacer } from "./Bleed";

export interface SnapHScrollProps {
  children?: ReactNode;
  /**
   * Unused on web — the column's own width drives the snap point.
   * Kept for API parity with the native variant.
   */
  snapInterval?: number;
  paddingLeft?: number;
  /** Space between the children, in pixels. */
  gap?: number;
}

const styles = css.create({
  scroller: {
    display: "flex",
    flexDirection: "row",
    overflowX: "auto",
    scrollSnapType: "x mandatory",
    // Snap in line with the page's margin, not the screen's edge, when
    // the scroller runs over the margin (Bleed).
    scrollPaddingInline: "var(--page-gutter, 0px)",
    // Hide scrollbar for the cleaner Trello-style swipe feel; users
    // get the peek of the next column as the affordance instead.
    scrollbarWidth: "none",
  },
  gap: (px: number) => ({
    gap: px,
  }),
  snapPoint: {
    // A row, so its child stretches to the row's height: every column as
    // tall as the tallest, as when they sat side by side in one row.
    display: "flex",
    flexDirection: "row",
    flexShrink: 0,
    scrollSnapAlign: "start",
  },
  padder: (px: number) => ({
    width: px,
    flexShrink: 0,
  }),
});

/**
 * Each child is a snap point: pass the columns themselves, not one
 * element holding them all. A single snap point as wide as the whole
 * row lets the browser pull the scroll back to its start from the end.
 */
export function SnapHScroll({ children, paddingLeft, gap = 0 }: SnapHScrollProps) {
  const wrapped = Children.map(children, (child, i) => (
    <html.div key={i} style={styles.snapPoint}>
      {child}
    </html.div>
  ));
  return (
    <html.div style={[styles.scroller, styles.gap(gap)]}>
      {paddingLeft ? <html.div style={styles.padder(paddingLeft)} /> : null}
      {/* The page's margin at each end, not snap points themselves. */}
      <GutterSpacer gap={gap} />
      {wrapped}
      <GutterSpacer gap={gap} />
    </html.div>
  );
}
