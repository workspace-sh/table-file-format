/**
 * Web variant — Vite picks this; Metro/RN picks the `.ts` default.
 *
 * Same `{ register, hitTest }` API as the native variant, but reads
 * rects via `getBoundingClientRect()` on demand instead of caching
 * from `onLayout`. Web doesn't have a cheap layout-event stream we
 * can subscribe to (ResizeObserver fires on size, not position), so
 * synchronous reads at hit-test time are both simpler and equally
 * cheap for the rect counts a viewer ever hits (≤ a few dozen drop
 * zones).
 */
import { useCallback, useRef } from "react";

export interface DropTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropTargetRegistration {
  ref: (el: HTMLElement | null) => void;
  /** Unused on web; kept for shape parity with the native variant. */
  onLayout?: (e: never) => void;
}

export interface DropTargets<K> {
  register: (key: K) => DropTargetRegistration;
  hitTest: (x: number, y: number) => K | null;
  /**
   * No-op on web — `hitTest` reads `getBoundingClientRect()` lazily,
   * so rects are always current. Exists for API parity with the
   * native variant, which has to explicitly re-measure.
   */
  remeasure: (key?: K) => void;
}

export function useDropTargets<K>(): DropTargets<K> {
  const elements = useRef<Map<K, HTMLElement>>(new Map());
  const registrations = useRef<Map<K, DropTargetRegistration>>(new Map());

  const register = useCallback((key: K): DropTargetRegistration => {
    const existing = registrations.current.get(key);
    if (existing) return existing;

    const reg: DropTargetRegistration = {
      ref: (el) => {
        if (el) elements.current.set(key, el);
        else elements.current.delete(key);
      },
    };
    registrations.current.set(key, reg);
    return reg;
  }, []);

  const hitTest = useCallback((x: number, y: number): K | null => {
    for (const [key, el] of elements.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
        return key;
      }
    }
    return null;
  }, []);

  // No-op on web — see interface doc. Reading rects lazily means
  // they're always fresh, so there's nothing to invalidate.
  const remeasure = useCallback((_key?: K) => {}, []);

  return { register, hitTest, remeasure };
}
