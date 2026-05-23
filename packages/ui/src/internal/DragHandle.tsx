/**
 * Native default — Metro resolves to this on iOS/Android/macOS.
 * Vite picks `.web.tsx`.
 *
 * Drag-source wrapper. We need a gesture mechanism that fires
 * onStart / onMove / onEnd reliably during a press-and-drag — and on
 * RN-macOS that rules out React's synthetic event tree (mouseUp /
 * pointerUp don't fire on drag-release, mouseMove isn't even wired
 * through by RSD, mouseEnter is hover-only). RN's responder system
 * (the native gesture coordinator) does fire those events reliably.
 *
 * `PanResponder` is the built-in entry point to the responder system.
 * No native module to link, no pod-install step. Works on iOS,
 * Android, macOS, and Windows.
 *
 * The wrapper renders a plain RN `View` (not an RSD html.div) because
 * RSD doesn't expose responder-system event handlers in its strict
 * prop whitelist. Layout-wise a View is interchangeable with the
 * html.div it replaces (both render to RN-View on native).
 *
 * Event payload normalised to `{ pageX, pageY }` — screen-space
 * coords for hit-testing against drop-target rects (which also live
 * in screen-space via `measureInWindow`).
 */
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { PanResponder, View } from "react-native";

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

export function DragHandle({
  children,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DragHandleProps) {
  const moveCountRef = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,

        onPanResponderGrant: (e) => {
          moveCountRef.current = 0;
          // eslint-disable-next-line no-console
          console.error(
            `[drag] Grant x=${e.nativeEvent.pageX} y=${e.nativeEvent.pageY}`,
          );
          onDragStart?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        onPanResponderMove: (e) => {
          moveCountRef.current++;
          // Log first move + every 10th to avoid log flood.
          if (moveCountRef.current === 1 || moveCountRef.current % 10 === 0) {
            // eslint-disable-next-line no-console
            console.error(
              `[drag] Move #${moveCountRef.current} x=${e.nativeEvent.pageX} y=${e.nativeEvent.pageY}`,
            );
          }
          onDragMove?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        onPanResponderRelease: (e) => {
          // eslint-disable-next-line no-console
          console.error(
            `[drag] Release (moves=${moveCountRef.current}) x=${e.nativeEvent.pageX} y=${e.nativeEvent.pageY}`,
          );
          onDragEnd?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },
        onPanResponderTerminate: (e) => {
          // eslint-disable-next-line no-console
          console.error(
            `[drag] Terminate (moves=${moveCountRef.current}) x=${e.nativeEvent.pageX} y=${e.nativeEvent.pageY}`,
          );
          onDragEnd?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        onPanResponderTerminationRequest: () => false,
      }),
    [onDragStart, onDragMove, onDragEnd],
  );

  return <View {...responder.panHandlers}>{children}</View>;
}
