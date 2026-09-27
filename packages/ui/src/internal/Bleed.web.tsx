/**
 * Web variant — Vite picks this. Metro picks `Bleed.tsx`.
 *
 * Something that scrolls sideways runs to the edges of the page, over
 * its side padding, rather than stopping at it: at rest its content
 * lines up with the page, and scrolled it passes under the margin to
 * the screen's edge. The page says how wide its margin is with the CSS
 * variable `--page-gutter`; a page that doesn't set it gets no bleed.
 */
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";

const GUTTER = "var(--page-gutter, 0px)";

const styles = css.create({
  bleed: {
    display: "flex",
    flexDirection: "column",
    marginInline: `calc(-1 * ${GUTTER})`,
    minWidth: 0,
  },
  spacer: (gap: number) => ({
    flexShrink: 0,
    width: `max(0px, calc(${GUTTER} - ${gap}px))`,
  }),
});

/** Widens its child scroller over the page's side margins. */
export function Bleed({ children }: { children?: ReactNode }) {
  return <html.div style={styles.bleed}>{children}</html.div>;
}

/**
 * The page's margin, inside a bled scroller: put one first and one last
 * so the content starts and ends where the page's does. `gap` is the
 * scroller's own gap between items, which the spacer makes up for.
 */
export function GutterSpacer({ gap = 0 }: { gap?: number }) {
  return <html.div aria-hidden={true} style={styles.spacer(gap)} />;
}
