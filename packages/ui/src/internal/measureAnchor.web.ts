/**
 * Web variant — Vite's resolve.extensions picks `.web.ts` ahead of
 * `.ts` so this file replaces the RN-View-based default when bundling
 * for the browser. No react-native dependency reaches the web bundle.
 *
 * Uses `Element.getBoundingClientRect()` which is sync; wrapped in
 * `Promise.resolve()` so the consumer API matches the native variant.
 */

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Returns `null` if the target is falsy or not a measurable element. */
export function measureAnchor(target: unknown): Promise<AnchorRect | null> {
  if (
    !target ||
    typeof (target as HTMLElement).getBoundingClientRect !== "function"
  ) {
    return Promise.resolve(null);
  }
  const r = (target as HTMLElement).getBoundingClientRect();
  return Promise.resolve({
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  });
}
