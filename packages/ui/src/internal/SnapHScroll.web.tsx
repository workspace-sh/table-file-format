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

export interface SnapHScrollProps {
  children?: ReactNode;
  /**
   * Unused on web — the column's own width drives the snap point.
   * Kept for API parity with the native variant.
   */
  snapInterval?: number;
  paddingLeft?: number;
}

const styles = css.create({
  scroller: {
    display: "flex",
    flexDirection: "row",
    overflowX: "auto",
    scrollSnapType: "x mandatory",
    // Hide scrollbar for the cleaner Trello-style swipe feel; users
    // get the peek of the next column as the affordance instead.
    scrollbarWidth: "none",
  },
  snapPoint: {
    flexShrink: 0,
    scrollSnapAlign: "start",
  },
  padder: (px: number) => ({
    width: px,
    flexShrink: 0,
  }),
});

export function SnapHScroll({
  children,
  paddingLeft,
}: SnapHScrollProps) {
  const wrapped = Children.map(children, (child, i) => (
    <html.div key={i} style={styles.snapPoint}>
      {child}
    </html.div>
  ));
  return (
    <html.div style={styles.scroller}>
      {paddingLeft ? <html.div style={styles.padder(paddingLeft)} /> : null}
      {wrapped}
    </html.div>
  );
}
