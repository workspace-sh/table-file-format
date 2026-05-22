/**
 * Web variant — Vite picks this. Metro picks `.ts` (which re-exports
 * the real RN Pressable).
 *
 * Wraps an html.div with mouse + touch handlers and normalises the
 * event payload so consumers see the same `{ nativeEvent: { pageX,
 * pageY } }` shape as on native. Web DOM dispatches mouseUp / touchEnd
 * reliably on press release, so we don't need RN's responder system
 * here — the wrapper exists purely for API parity with the native
 * variant.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { html } from "react-strict-dom";

export interface DragPressEvent {
  nativeEvent: {
    pageX: number;
    pageY: number;
  };
}

export interface DragPressableProps {
  children?: ReactNode;
  onPressIn?: (e: DragPressEvent) => void;
  onPressOut?: (e: DragPressEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coords(e: any): { x: number; y: number } | null {
  if (typeof e?.clientX === "number" && typeof e?.clientY === "number") {
    return { x: e.clientX, y: e.clientY };
  }
  if (e?.touches?.length > 0) {
    const t = e.touches[0];
    if (typeof t.clientX === "number" && typeof t.clientY === "number") {
      return { x: t.clientX, y: t.clientY };
    }
  }
  // changedTouches covers touchend (touches is empty at that point).
  if (e?.changedTouches?.length > 0) {
    const t = e.changedTouches[0];
    if (typeof t.clientX === "number" && typeof t.clientY === "number") {
      return { x: t.clientX, y: t.clientY };
    }
  }
  return null;
}

export function DragPressable({
  children,
  onPressIn,
  onPressOut,
}: DragPressableProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleIn = onPressIn
    ? (e: any) => {
        const c = coords(e);
        if (c) onPressIn({ nativeEvent: { pageX: c.x, pageY: c.y } });
      }
    : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOut = onPressOut
    ? (e: any) => {
        const c = coords(e);
        if (c) onPressOut({ nativeEvent: { pageX: c.x, pageY: c.y } });
      }
    : undefined;

  return createElement(
    html.div,
    {
      onMouseDown: handleIn,
      onMouseUp: handleOut,
      onTouchStart: handleIn,
      onTouchEnd: handleOut,
    },
    children,
  );
}
