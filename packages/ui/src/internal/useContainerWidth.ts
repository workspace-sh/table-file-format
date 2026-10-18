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
 * orientation changes, measuring again as the new layout settles. That
 * covers iOS rotation. A change the system
 * doesn't announce (a Mac window dragged wider, its sidebar or inspector
 * opening) comes from the host, which says when its content's own view
 * was laid out again (`notifyLayoutChanged`, internal/relayout).
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dimensions } from "react-native";
import { LayoutChannel } from "./relayout";

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

/** How long a width held back (`later`) waits for the size to stop changing. */
const LATER_MS = 250;

/**
 * `later(from, to)`: whether a new width can wait until the size stops
 * changing, as when what's measured is laid out by it without being drawn
 * again (a table whose columns share its width either side). It's taken
 * once it has been still a moment.
 */
export function useContainerWidth(later?: (from: number, to: number) => boolean): ContainerMeasurement {
  const [width, setWidth] = useState(0);
  const nodeRef = useRef<MeasurableNode | null>(null);
  const listen = useContext(LayoutChannel);
  const shown = useRef(0);
  const laterRef = useRef(later);
  laterRef.current = later;
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One measurement at a time: asked again while one is under way, it's
  // measured once more when that one comes back, not once for every ask.
  const measuring = useRef(false);
  const again = useRef(false);

  const take = useCallback((w: number) => {
    if (waiting.current) clearTimeout(waiting.current);
    waiting.current = null;
    if (w === shown.current) return;
    const show = () => {
      waiting.current = null;
      shown.current = w;
      setWidth(w);
    };
    if (shown.current > 0 && laterRef.current?.(shown.current, w)) waiting.current = setTimeout(show, LATER_MS);
    else show();
  }, []);

  const measureRef = useRef<() => void>(() => {});
  const measure = useCallback(() => {
    const node = nodeRef.current;
    if (!node?.measureInWindow) return;
    if (measuring.current) {
      again.current = true;
      return;
    }
    measuring.current = true;
    node.measureInWindow((_x, _y, w) => {
      measuring.current = false;
      if (typeof w === "number") take(w);
      if (again.current) {
        again.current = false;
        measureRef.current();
      }
    });
  }, [take]);
  measureRef.current = measure;

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

  // Re-measure on window resize / orientation change. The event comes
  // before the views have their new sizes, and a rotation's layout settles
  // over a few frames, so it's measured again as it settles: once only
  // could read the old width and keep it. A Mac window being resized sends
  // a change at every step of the drag: each one starts the three again
  // rather than adding three more, so a drag measures at most once a step
  // (and settles once it stops), not three times a step for every table on
  // screen, all queued behind each other.
  useEffect(() => {
    let settling: ReturnType<typeof setTimeout>[] = [];
    const stopSettling = () => {
      for (const timer of settling) clearTimeout(timer);
      settling = [];
    };
    const sub = Dimensions.addEventListener("change", () => {
      stopSettling();
      settling = [0, 100, 300].map((ms) => setTimeout(measure, ms));
    });
    // And when the host says the space it's in was laid out again.
    const stop = listen(measure);
    return () => {
      sub.remove();
      stop();
      stopSettling();
      if (waiting.current) clearTimeout(waiting.current);
    };
  }, [measure, listen]);

  return { measureProps: { ref }, width };
}
