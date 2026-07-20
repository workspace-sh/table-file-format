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
    // Hides the macOS overlay scrollbar when there's no overflow.
    // Keep visible when actually scrollable so users get feedback.
    flex: 1,
  },
});

export interface HScrollProps {
  children?: ReactNode;
  /** Accepted for shape parity with native; unused on web. */
  scrollProps?: unknown;
}

export function HScroll({ children }: HScrollProps) {
  return <html.div style={styles.scroll}>{children}</html.div>;
}
