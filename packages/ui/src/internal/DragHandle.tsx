/**
 * Native default — Metro on iOS / Android / macOS resolves to this.
 * Vite picks `.web.tsx`.
 *
 * Backed by `react-native-gesture-handler` instead of RN's built-in
 * `PanResponder`. PanResponder uses the RN responder system which
 * was designed for touch — its RN-macOS port only dispatches
 * `onResponderMove` once per gesture (empirically confirmed via
 * extensive logging), making continuous drag tracking impossible.
 *
 * Gesture Handler has its own native gesture recognizers (UIKit on
 * iOS, NSGestureRecognizer on macOS, GestureDetector on Android),
 * dispatching continuous updates throughout the press-drag — which
 * is exactly what we need for live drop-target hit-testing.
 *
 * Setup requirement (one-time per app):
 *   1. App roots are wrapped in `<GestureHandlerRootView>` (done in
 *      apps/desktop/App.tsx and apps/mobile/App.tsx).
 *   2. On iOS / macOS, `pod install` must be run after npm install
 *      so the native module links into the build.
 *
 * Event payload normalised to `{ pageX, pageY }` (screen-space) for
 * parity with the web variant. RNGH calls these `absoluteX` /
 * `absoluteY`.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

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
  const gesture = useMemo(() => {
    return (
      Gesture.Pan()
        // Run callbacks on the JS thread, not as Reanimated worklets.
        // State updates flow through React; no Reanimated dependency.
        .runOnJS(true)
        // Activate immediately on press, without a motion threshold.
        // Default is ~10pt which would delay the visual lift.
        .minDistance(0)
        .onStart((e) => {
          onDragStart?.({ pageX: e.absoluteX, pageY: e.absoluteY });
        })
        .onUpdate((e) => {
          onDragMove?.({ pageX: e.absoluteX, pageY: e.absoluteY });
        })
        .onEnd((e) => {
          onDragEnd?.({ pageX: e.absoluteX, pageY: e.absoluteY });
        })
        // Fires for system-cancelled gestures (another recognizer
        // wins). Treat as release so we don't leak drag state.
        .onFinalize((e, success) => {
          if (!success) {
            onDragEnd?.({ pageX: e.absoluteX, pageY: e.absoluteY });
          }
        })
    );
  }, [onDragStart, onDragMove, onDragEnd]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <GestureDetector gesture={gesture}>{children as any}</GestureDetector>
  );
}
