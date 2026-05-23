/**
 * Web variant — Vite picks this; Metro picks the `.ts` default.
 *
 * Same `{ register, hitTest, remeasure }` API as the native variant.
 * Reads rects via `getBoundingClientRect()` on demand at hit-test
 * time — cheap on web and always current, so no caching needed.
 * `remeasure` is a no-op for shape parity with native.
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
}

export interface DropTargets<K> {
  register: (key: K) => DropTargetRegistration;
  hitTest: (x: number, y: number) => K | null;
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

  // Same nearest-with-tolerance logic as the native variant — keeps
  // drops in the gap between drop zones (board's 12px column gap, list's
  // border-bottom strip) from missing.
  const HIT_SLOP = 16;
  const hitTest = useCallback((x: number, y: number): K | null => {
    let nearestKey: K | null = null;
    let nearestDist = HIT_SLOP;
    for (const [key, el] of elements.current) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      if (dx === 0 && dy === 0) return key;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= nearestDist) {
        nearestDist = dist;
        nearestKey = key;
      }
    }
    return nearestKey;
  }, []);

  // No-op — reads are lazy, rects always current.
  const remeasure = useCallback((_key?: K) => {}, []);

  return { register, hitTest, remeasure };
}
