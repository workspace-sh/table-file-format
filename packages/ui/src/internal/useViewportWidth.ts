/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.ts` variant exists. Vite on web resolves to `.web.ts` first
 * (the web variant doesn't depend on react-native).
 *
 * Returns the current window width in CSS-equivalent points. Re-renders
 * the consuming component on orientation change / size class change.
 */
import { Platform, useWindowDimensions } from "react-native";

export function useViewportWidth(): number {
  return useWindowDimensions().width;
}

/**
 * Whether to lay out for a compact, touch screen: a window no wider than
 * `max`. On a phone or tablet it's the screen's shorter side, which turning
 * it doesn't change: a phone is a phone in landscape too. Laid out by the
 * width it had at the moment, a phone switched layouts at every turn (a
 * table between scrolling whole and a frozen title column, every row and
 * cell built again; a board between its carousel and free scrolling): the
 * jump a turn made (#610). On the Mac it's the window's width, which only
 * resizing changes.
 */
export function useCompactViewport(max: number): boolean {
  const { width, height } = useWindowDimensions();
  const side = Platform.OS === "ios" || Platform.OS === "android" ? Math.min(width, height) : width;
  return side <= max;
}
