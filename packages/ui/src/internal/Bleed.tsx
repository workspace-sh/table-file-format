/**
 * Native variant — Metro picks this. Vite picks `Bleed.web.tsx`.
 *
 * Something that scrolls sideways runs to the edges of the screen, over
 * the page's side margin, rather than stopping at it: at rest its content
 * lines up with the page, and scrolled it passes under the margin to the
 * screen's edge. The app says how wide its margin is (PageGutter); an app
 * that doesn't gets no bleed.
 */
import { useContext, type ReactNode } from "react";
import { View } from "react-native";
import { PageGutter } from "../pageGutter";

/** Widens its child scroller over the page's side margins. */
export function Bleed({ children }: { children?: ReactNode }) {
  const gutter = useContext(PageGutter);
  if (gutter === 0) return <>{children}</>;
  return <View style={{ marginHorizontal: -gutter }}>{children}</View>;
}

/**
 * The page's margin, inside a bled scroller: put one first and one last
 * so the content starts and ends where the page's does. `gap` is the
 * scroller's own gap between items, which the spacer makes up for.
 */
export function GutterSpacer({ gap = 0 }: { gap?: number }) {
  const width = Math.max(0, useContext(PageGutter) - gap);
  return width > 0 ? <View style={{ width }} /> : null;
}
