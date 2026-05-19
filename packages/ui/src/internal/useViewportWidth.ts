/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.ts` variant exists. Vite on web resolves to `.web.ts` first
 * (the web variant doesn't depend on react-native).
 *
 * Returns the current window width in CSS-equivalent points. Re-renders
 * the consuming component on orientation change / size class change.
 */
import { useWindowDimensions } from "react-native";

export function useViewportWidth(): number {
  return useWindowDimensions().width;
}
