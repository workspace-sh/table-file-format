/**
 * Native default — Metro resolves to this when no `.native.ts` exists.
 * Vite picks the `.web.ts` variant.
 *
 * Drag-and-drop drop-target registry. The consuming view (Board, List)
 * registers each candidate drop zone, then on pointer-move calls
 * `hitTest(x, y)` to find which one the finger / mouse is over.
 *
 * Why this exists: per-target `onPointerEnter` / `onPointerLeave`
 * works for mouse drags (web, macOS desktop) but not for touch drags
 * on RN — those events are hover-only, mouse-only. Root-level
 * pointermove + rect hit-test bridges both cases with one code path.
 *
 * RSD's strict prop whitelist rejects `onLayout`, so we can't observe
 * layout passively. Instead the consumer calls `remeasure()` at the
 * moments layout could have changed:
 *   - on drag-start (initial population of the rect cache)
 *   - after any state change that reorders targets (list reorder,
 *     board column add)
 *
 * `measureInWindow` is callback-based but fast on macOS-desktop where
 * native runs on the same thread. iOS routes through the bridge but
 * the bursts here are small (≤ a few dozen targets) and only fire
 * around layout commits.
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
  /** Unused on native; shape parity with the web variant. */
  onLayout?: (e: never) => void;
}

export interface DropTargets<K> {
  /** Spread onto the drop-target element to register it. */
  register: (key: K) => DropTargetRegistration;
  /** Returns the key of the target containing (x, y), or null. */
  hitTest: (x: number, y: number) => K | null;
  /**
   * Re-measure all (or one) registered target. Call on drag-start and
   * after layout-changing state updates.
   */
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
    if (!node?.measureInWindow) {
      // eslint-disable-next-line no-console
      console.error(`[drag] measureOne ${String(key)} — no node or no measureInWindow`);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (!nodes.current.has(key)) return;
      rects.current.set(key, { x, y, width, height });
      // eslint-disable-next-line no-console
      console.error(
        `[drag] rect ${String(key)} = ${x},${y} ${width}x${height}`,
      );
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
            // Initial measurement so first-hit-after-mount works even
            // without an explicit remeasure call. Defer to next tick
            // so layout has committed.
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
