/**
 * Web variant — Vite picks this. Metro picks `HScroll.tsx`.
 *
 * `overflowX: auto` on an html.div delivers native browser horizontal
 * scrolling with a scrollbar that appears only when content overflows.
 * RSD warns about `overflowX` on the native side (the prop is web-only)
 * which is why we keep this off the cross-platform code path.
 */
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";

const styles = css.create({
  scroll: {
    display: "flex",
    flexDirection: "row",
    overflowX: "auto",
    // overflow-x makes this a vertical scroller too. The frozen column
    // beside it can't scroll, so nothing here may: a vertical drag moves
    // the page, never these columns out of line with the frozen one.
    overflowY: "hidden",
    // Hides the macOS overlay scrollbar when there's no overflow.
    // Keep visible when actually scrollable so users get feedback.
    flex: 1,
  },
  // The browser's own snapping: it brings a scroll to rest on a mark as its
  // momentum ends, and leaves a drag or a wheel alone until then.
  snaps: {
    position: "relative",
    scrollSnapType: "x mandatory",
  },
  // The marks hang from the scroller's start and scroll with what's in it.
  marks: {
    position: "absolute",
    top: 0,
    insetInlineStart: 0,
    width: 0,
    height: 0,
    pointerEvents: "none",
  },
  mark: (at: number) => ({
    position: "absolute",
    top: 0,
    insetInlineStart: at,
    width: 1,
    height: 1,
    scrollSnapAlign: "start",
  }),
});

export interface HScrollProps {
  children?: ReactNode;
  /** Accepted for shape parity with native; unused on web. */
  scrollProps?: unknown;
  /**
   * Where the scroll comes to rest, as offsets from its start (a table's
   * column starts): a scroll the user ends settles on the nearest, so
   * nothing is left cut in half at the edge. The end is always one.
   */
  snapTo?: readonly number[];
}

export function HScroll({ children, snapTo }: HScrollProps) {
  const snaps = snapTo !== undefined && snapTo.length > 0;
  return (
    <html.div style={[styles.scroll, snaps && styles.snaps]}>
      {snaps && (
        <html.div aria-hidden={true} style={styles.marks}>
          {snapTo.map((at) => (
            <html.div key={at} style={styles.mark(at)} />
          ))}
        </html.div>
      )}
      {children}
    </html.div>
  );
}
