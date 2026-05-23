/**
 * Native default — Metro resolves to this. Vite picks `.web.ts`.
 *
 * Drop-target registry for drag-and-drop. Each candidate drop zone
 * registers itself via `register(key)`, which returns a ref to attach
 * to the zone's container. On every `hitTest(x, y)`, the registry
 * returns the key of the zone containing those screen-space coords,
 * or null.
 *
 * RSD's strict prop whitelist rejects `onLayout`, so we can't listen
 * passively for layout changes. Instead the consumer calls
 * `remeasure()` at moments layout might have changed (drag-start,
 * post-state-change), and on initial ref attach. `measureInWindow`
 * fires the callback async on the native bridge but is cheap enough
 * for the small target counts a viewer ever shows (≤ a few dozen).
 */
import { useCallback, useRef } from "react";

export interface DropTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropTargetRegistration {
  ref: (el: unknown) => void;
}

export interface DropTargets<K> {
  /** Spread onto the drop-target element to register it. */
  register: (key: K) => DropTargetRegistration;
  /** Returns the key of the target containing (x, y), or null. */
  hitTest: (x: number, y: number) => K | null;
  /** Re-measure all (or one) registered target. */
  remeasure: (key?: K) => void;
}

type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
) => void;

interface MeasurableNode {
  measureInWindow?: (callback: MeasureCallback) => void;
}

export function useDropTargets<K>(): DropTargets<K> {
  const rects = useRef<Map<K, DropTargetRect>>(new Map());
  const nodes = useRef<Map<K, MeasurableNode>>(new Map());
  const registrations = useRef<Map<K, DropTargetRegistration>>(new Map());

  const measureOne = useCallback((key: K) => {
    const node = nodes.current.get(key);
    if (!node?.measureInWindow) return;
    node.measureInWindow((x, y, width, height) => {
      if (!nodes.current.has(key)) return;
      rects.current.set(key, { x, y, width, height });
    });
  }, []);

  const remeasure = useCallback(
    (key?: K) => {
      if (key !== undefined) {
        measureOne(key);
        return;
      }
      for (const k of nodes.current.keys()) measureOne(k);
    },
    [measureOne],
  );

  const register = useCallback(
    (key: K): DropTargetRegistration => {
      const existing = registrations.current.get(key);
      if (existing) return existing;

      const reg: DropTargetRegistration = {
        ref: (el) => {
          if (el) {
            nodes.current.set(key, el as MeasurableNode);
            // Defer to next tick so layout has committed.
            setTimeout(() => measureOne(key), 0);
          } else {
            nodes.current.delete(key);
            rects.current.delete(key);
          }
        },
      };
      registrations.current.set(key, reg);
      return reg;
    },
    [measureOne],
  );

  const hitTest = useCallback((x: number, y: number): K | null => {
    for (const [key, r] of rects.current) {
      if (
        x >= r.x &&
        x < r.x + r.width &&
        y >= r.y &&
        y < r.y + r.height
      ) {
        return key;
      }
    }
    return null;
  }, []);

  return { register, hitTest, remeasure };
}
