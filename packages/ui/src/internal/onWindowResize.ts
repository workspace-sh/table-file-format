/**
 * Native default — Metro picks this. Vite picks `onWindowResize.web.ts`.
 *
 * Told when the window changes size (a phone turned, a window resized).
 * What was placed over a cell from where the cell was then is no longer
 * over it, so it is closed, or placed again. Returns the way to stop.
 */
import { Dimensions } from "react-native";

export function onWindowResize(listener: () => void): () => void {
  const sub = Dimensions.addEventListener("change", listener);
  return () => sub.remove();
}
