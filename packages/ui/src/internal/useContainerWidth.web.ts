/**
 * Web variant of `useContainerWidth`. Uses `ResizeObserver` (universal
 * in evergreen browsers since 2020) to track the target element's
 * width. Subscribes synchronously in the ref callback so the FIRST
 * paint already has the correct measurement — no flash of zero-width
 * cells the way an `onLayout`-style hook would have on RN.
 *
 * Cost: one observer per consuming component, fires only on actual
 * resize events. ResizeObserver is OS-event-driven, not polled, so
 * idle cost is zero.
 *
 * Returns the same `{ measureProps, width }` shape as the native
 * variant. `measureProps` here contains `ref` (a callback ref); on
 * native it contains `onLayout`. Consumers spread it onto the target
 * `html.div` and don't care which attachment mechanism is in use.
 */
import { useCallback, useRef, useState } from "react";

export interface ContainerMeasurement {
  measureProps: {
    ref?: (el: HTMLElement | null) => void;
    onLayout?: (e: never) => void; // unused on web; type parity with native
  };
  width: number;
}

export function useContainerWidth(): ContainerMeasurement {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    // Always clean up before re-binding — the same hook instance can be
    // attached to a new element after a remount, and we don't want
    // stranded observers.
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) return;

    // Set initial width synchronously so the first paint has correct
    // geometry. ResizeObserver alone would only fire AFTER the first
    // paint, producing a brief flash of zero-width cells.
    setWidth(el.getBoundingClientRect().width);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  return {
    measureProps: { ref },
    width,
  };
}
