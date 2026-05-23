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
import { useMemo } from "react";
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
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture on press-down. `onStartShould...` runs
        // when the user first touches; returning true makes this
        // View the active responder, suppressing parent scroll
        // interception for the duration of the press.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,

        onPanResponderGrant: (e) => {
          onDragStart?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        onPanResponderMove: (e) => {
          onDragMove?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        // Both fire at gesture end. `Release` is the normal "user
        // lifted finger / mouse"; `Terminate` is when something else
        // claims the gesture (parent scroll, system interrupt). Treat
        // both as end-of-drag — the consumer's onDragEnd is
        // responsible for commit-or-cancel logic.
        onPanResponderRelease: (e) => {
          onDragEnd?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },
        onPanResponderTerminate: (e) => {
          onDragEnd?.({
            pageX: e.nativeEvent.pageX,
            pageY: e.nativeEvent.pageY,
          });
        },

        // Don't surrender the gesture once granted — keeps the drag
        // alive even if the user's finger crosses a scrollable parent.
        onPanResponderTerminationRequest: () => false,
      }),
    [onDragStart, onDragMove, onDragEnd],
  );

  return <View {...responder.panHandlers}>{children}</View>;
}
