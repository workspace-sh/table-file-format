/**
 * Native default — the twin of useViewportWidth. Returns the window height,
 * re-rendering on rotation and size-class change.
 */
import { useWindowDimensions } from "react-native";

export function useViewportHeight(): number {
  return useWindowDimensions().height;
}
