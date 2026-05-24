/**
 * Web variant — Vite picks this; Metro picks `.tsx`.
 *
 * Uses pointer events with `setPointerCapture` for full-lifecycle
 * tracking: once the user presses down, the captured element
 * receives every subsequent pointermove and pointerup, regardless
 * of which DOM node the cursor is over. That's exactly the
 * semantics we need for drag-and-drop, without needing a window-
 * level listener or to chase events through deep nesting.
 *
 * Event payload normalised to `{ pageX, pageY }` — same shape as
 * the native variant, so consumers don't branch on platform.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { html } from "react-strict-dom";

export interface DragEvent {
  pageX: number;
  pageY: number;
}

export interface DragHandleProps {
  children?: ReactNode;
  onDragStart?: (e: DragEvent) => void;
  onDragMove?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}

interface PointerEventLike {
  clientX: number;
  clientY: number;
  pointerId: number;
  currentTarget: {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  preventDefault?: () => void;
}

export function DragHandle({
  children,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DragHandleProps) {
  const activeRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Disable text selection on the document body while dragging — keeps
  // cursor-drag across cells from highlighting their text. No equivalent
  // problem on native (no text selection during a press-drag).
  useEffect(() => {
    if (!dragging) return;
    if (typeof document === "undefined") return;
    const body = document.body.style as unknown as Record<string, string>;
    const prev = body.userSelect;
    const prevWebkit = body.webkitUserSelect;
    body.userSelect = "none";
    body.webkitUserSelect = "none";
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    return () => {
      body.userSelect = prev;
      body.webkitUserSelect = prevWebkit;
    };
  }, [dragging]);

  const handlePointerDown = (e: PointerEventLike) => {
    activeRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onDragStart?.({ pageX: e.clientX, pageY: e.clientY });
  };

  const handlePointerMove = (e: PointerEventLike) => {
    if (!activeRef.current) return;
    onDragMove?.({ pageX: e.clientX, pageY: e.clientY });
  };

  const handlePointerUp = (e: PointerEventLike) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onDragEnd?.({ pageX: e.clientX, pageY: e.clientY });
  };

  const handlePointerCancel = (e: PointerEventLike) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setDragging(false);
    onDragEnd?.({ pageX: e.clientX, pageY: e.clientY });
  };

  return (
    <html.div
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPointerDown={handlePointerDown as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPointerMove={handlePointerMove as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPointerUp={handlePointerUp as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPointerCancel={handlePointerCancel as any}
    >
      {children}
    </html.div>
  );
}
