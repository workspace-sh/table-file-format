/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.ts` variant exists. Vite on web resolves to `.web.ts` first.
 *
 * Measures the width of the component this hook's `measureProps` are
 * spread onto. Use it when you need cells / columns sized to the
 * actual rendered container width — e.g. a table inside a sidebar
 * layout where the container is narrower than the viewport.
 *
 * RSD's strict prop whitelist on native rejects `onLayout` (it's not
 * one of the spec'd "web" event names), so we can't go through the
 * usual RN layout-event channel. Instead: attach a ref to the html.div,
 * call `measureInWindow` on attach to seed the initial size, then
 * subscribe to `Dimensions` change events to catch window resizes /
 * orientation changes. That covers iOS rotation. A change the system
 * doesn't announce (a Mac window dragged wider, its sidebar or inspector
 * opening) comes from the host, which says when its content's own view
 * was laid out again (`notifyLayoutChanged`, internal/relayout).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions } from "react-native";
import { onLayoutChanged } from "./relayout";

export interface ContainerMeasurement {
  measureProps: {
    ref?: (el: unknown) => void;
    /** Unused on native; shape parity with the web variant. */
    onLayout?: (e: never) => void;
  };
  width: number;
}

interface MeasurableNode {
  measureInWindow?: (
    callback: (x: number, y: number, w: number, h: number) => void,
  ) => void;
}

export function useContainerWidth(): ContainerMeasurement {
  const [width, setWidth] = useState(0);
  const nodeRef = useRef<MeasurableNode | null>(null);

  const measure = useCallback(() => {
    const node = nodeRef.current;
    if (!node?.measureInWindow) return;
    node.measureInWindow((_x, _y, w) => {
      if (typeof w !== "number") return;
      setWidth((prev) => (prev === w ? prev : w));
    });
  }, []);

  const ref = useCallback(
    (el: unknown) => {
      nodeRef.current = (el ?? null) as MeasurableNode | null;
      // measureInWindow returns 0×0 if called before layout commits;
      // setTimeout pushes us past the first layout pass without
      // needing onLayout (which RSD won't pass through).
      if (el) setTimeout(measure, 0);
    },
    [measure],
  );

  // Re-measure on window resize / orientation change.
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", () => {
      setTimeout(measure, 0);
    });
    // And when the host says its content was laid out again.
    const stop = onLayoutChanged(measure);
    return () => {
      sub.remove();
      stop();
    };
  }, [measure]);

  return { measureProps: { ref }, width };
}
