/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.ts` variant exists. Vite on web resolves to `.web.ts` first.
 *
 * Measures the width of the component this hook's `measureProps` are
 * spread onto. Use it when you need cells / columns sized to the
 * actual rendered container width, not the window width — e.g. a
 * table inside a sidebar layout where the container is narrower than
 * the viewport.
 *
 * Cost: one component re-render per resize / orientation change. The
 * width math at the call site is O(1) (e.g. `viewport / ncols`); this
 * just supplies the reactive input. Negligible at the row counts a
 * spike viewer ever shows.
 *
 * Returns `{ measureProps, width }`. Spread `measureProps` onto the
 * target element (e.g. `<html.div {...measureProps}>`); read `width`
 * for layout math. On native `measureProps` contains `onLayout` (RN's
 * standard primitive); on web it contains `ref` (ResizeObserver
 * driven). The consumer doesn't care which — it just spreads.
 *
 * Width is `0` until the first layout pass completes; consumers
 * should either guard (`width > 0 ? compute(width) : fallback`) or
 * render with a placeholder until measured.
 */
import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

export interface ContainerMeasurement {
  measureProps: {
    ref?: (el: HTMLElement | null) => void;
    onLayout?: (e: LayoutChangeEvent) => void;
  };
  width: number;
}

export function useContainerWidth(): ContainerMeasurement {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // Bail on idempotent updates so we don't trigger a React re-render
    // every layout pass when the container hasn't actually resized.
    setWidth((prev) => (prev === w ? prev : w));
  }, []);
  return {
    measureProps: { onLayout },
    width,
  };
}
