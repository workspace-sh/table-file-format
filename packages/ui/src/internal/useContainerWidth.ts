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
 * one of the spec'd "web" event names), so the container can't be told
 * when its size changes. Its `probe` can: an untouchable view laid over
 * the container, rendered as one of its children, whose `onLayout`
 * fires once whenever the container is laid out at a new size, after
 * layout has finished. A turned phone (and its safe area, which arrives
 * after the turn), a Mac window or split resized, a frame in a document
 * moved to a new width: each is one event, at the moment the size is
 * final, so nothing is measured mid-change and nothing is missed (#610).
 * The width itself is the container's own, measured then
 * (`measureInWindow`, its border box), as the columns expect.
 */
import { createElement, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

export interface ContainerMeasurement {
  measureProps: {
    ref?: (el: unknown) => void;
    /** Unused on native; shape parity with the web variant. */
    onLayout?: (e: never) => void;
  };
  width: number;
  /** Rendered as a child of the measured container: what says it was laid out again. Null on the web. */
  probe: ReactNode;
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

  const ref = useCallback((el: unknown) => {
    nodeRef.current = (el ?? null) as MeasurableNode | null;
  }, []);

  const probe = useMemo(
    () => createElement(View, { pointerEvents: "none", style: StyleSheet.absoluteFill, onLayout: measure }),
    [measure],
  );

  return { measureProps: { ref }, width, probe };
}
