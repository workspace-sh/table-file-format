/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.ts` variant exists. Vite on web resolves to `.web.ts` first.
 *
 * Cross-platform "measure this anchor's viewport-relative rect" — used
 * for positioning popovers next to column headers, body-editor anchors,
 * etc. Standardised on an async Promise return shape because RN's
 * `View.measure()` is callback-based (async); wrapping web's sync
 * `getBoundingClientRect()` in `Promise.resolve()` is cheap and keeps
 * the consumer code identical on both platforms.
 *
 * Coordinates are viewport-relative (pageX / pageY on native, top /
 * left on web). The returned `AnchorRect` is intentionally minimal —
 * just what popover positioning needs.
 */
import type { View } from "react-native";

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Returns `null` if the target is falsy or doesn't support `measure()`. */
export function measureAnchor(target: unknown): Promise<AnchorRect | null> {
  if (!target || typeof (target as View).measure !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    (target as View).measure((_x, _y, width, height, pageX, pageY) => {
      resolve({ top: pageY, left: pageX, width, height });
    });
  });
}
