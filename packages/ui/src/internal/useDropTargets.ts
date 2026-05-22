/**
 * Native default — Metro resolves to this when no `.native.ts` exists.
 * Vite picks the `.web.ts` variant.
 *
 * Drag-and-drop drop-target registry for touch-driven drags. RN
 * doesn't fire `onPointerEnter` / `onPointerLeave` for a finger
 * sliding across views (those are hover events, mouse-only), so the
 * board / list views can't use per-target enter handlers to detect
 * which column / row the finger is currently over. This hook routes
 * detection through a single root-level `onPointerMove` instead:
 *
 *   const { register, hitTest } = useDropTargets<string>();
 *   // root container's onPointerMove handler:
 *   const key = hitTest(x, y);
 *   // each drop target:
 *   <html.div {...register('column-1')}>
 *
 * On native we cache each target's screen-space rect via
 * `measureInWindow` triggered by `onLayout`. RN re-fires `onLayout`
 * whenever the layout engine repositions a view, so the cache stays
 * fresh through list reorders / column resizes without any manual
 * invalidation. `hitTest` reads the cached rects synchronously.
 *
 * RN's pointer events expose screen-space coords via
 * `nativeEvent.pageX/pageY`, so callers compute the same coordinate
 * space we cache against.
 */
import { useCallback, useRef } from "react";
import type { LayoutChangeEvent } from "react-native";

export interface DropTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropTargetRegistration {
  ref: (el: unknown) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}

export interface DropTargets<K> {
  /** Spread onto the drop-target element to register it. */
  register: (key: K) => DropTargetRegistration;
  /** Returns the key of the target containing (x, y), or null. */
  hitTest: (x: number, y: number) => K | null;
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
  // refs keep stable identity across renders; the consumer's
  // `register('foo')` must return the SAME ref callback shape on
  // every render or React would detach + re-attach the ref every
  // render. We index by key into refs that are themselves stable
  // closures (created lazily and memoised in `registrations`).
  const rects = useRef<Map<K, DropTargetRect>>(new Map());
  const nodes = useRef<Map<K, MeasurableNode>>(new Map());
  const registrations = useRef<Map<K, DropTargetRegistration>>(new Map());

  const measure = useCallback((key: K) => {
    const node = nodes.current.get(key);
    if (!node?.measureInWindow) return;
    node.measureInWindow((x, y, width, height) => {
      // `measureInWindow` fires async; bail if the node was unregistered
      // before the callback ran.
      if (!nodes.current.has(key)) return;
      rects.current.set(key, { x, y, width, height });
    });
  }, []);

  const register = useCallback(
    (key: K): DropTargetRegistration => {
      const existing = registrations.current.get(key);
      if (existing) return existing;

      const reg: DropTargetRegistration = {
        ref: (el) => {
          if (el) {
            nodes.current.set(key, el as MeasurableNode);
            // Measure right after mount — onLayout fires too late on
            // some platforms to seed the rect before the first drag.
            measure(key);
          } else {
            nodes.current.delete(key);
            rects.current.delete(key);
          }
        },
        onLayout: () => {
          // `onLayout` gives parent-relative coords; we need
          // screen-space. Re-measure via the node.
          measure(key);
        },
      };
      registrations.current.set(key, reg);
      return reg;
    },
    [measure],
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

  return { register, hitTest };
}
