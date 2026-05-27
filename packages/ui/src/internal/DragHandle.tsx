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
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
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
  /**
   * When set, the gesture only activates after a press of this many
   * milliseconds. Use on touch surfaces where a quick swipe means
   * "scroll" and a held press means "drag" — the standard mobile
   * idiom (Trello, Notion, iOS home screen). Omit on desktop / web
   * where immediate-activation feels right with mouse input.
   */
  longPressMs?: number;
}

export function DragHandle({
  children,
  onDragStart,
  onDragMove,
  onDragEnd,
  longPressMs,
}: DragHandleProps) {
  // Read callbacks through refs so the gesture object stays stable
  // across renders. Without this, consumers passing inline lambdas
  // (the common case) caused `useMemo` to recompute the gesture on
  // every render. GestureDetector then tore down + re-attached the
  // RNGH handler mid-gesture; RNGH re-fired `onUpdate` against the
  // new handler with the live cursor position; the callback called
  // `setPointerPos`; React re-rendered; loop ("Maximum update depth
  // exceeded"). Refs let the gesture point at a stable indirection
  // while still calling the latest consumer callback every fire.
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd };

  const gesture = useMemo(() => {
    let pan = Gesture.Pan()
      // Run callbacks on the JS thread, not as Reanimated worklets.
      // State updates flow through React; no Reanimated dependency.
      .runOnJS(true)
      // Activate immediately on press once the long-press gate (if
      // any) clears — no additional movement threshold.
      .minDistance(0);
    if (longPressMs && longPressMs > 0) {
      pan = pan
        .activateAfterLongPress(longPressMs)
        // Yield the gesture to a parent ScrollView when the user
        // pans before the long-press timer fires. Without this, the
        // pan sits in BEGAN state blocking the parent — list rows
        // can't scroll vertically, board cards can't swipe between
        // columns. ±15pt is loose enough not to fight micro-jitter
        // during a deliberate hold but tight enough that any real
        // scrolling intent immediately wins.
        .failOffsetX([-15, 15])
        .failOffsetY([-15, 15]);
    }
    return pan
      .onStart((e) => {
        callbacksRef.current.onDragStart?.({
          pageX: e.absoluteX,
          pageY: e.absoluteY,
        });
      })
      .onUpdate((e) => {
        callbacksRef.current.onDragMove?.({
          pageX: e.absoluteX,
          pageY: e.absoluteY,
        });
      })
      .onEnd((e) => {
        callbacksRef.current.onDragEnd?.({
          pageX: e.absoluteX,
          pageY: e.absoluteY,
        });
      })
      // Fires for system-cancelled gestures (another recognizer
      // wins). Treat as release so we don't leak drag state.
      .onFinalize((e, success) => {
        if (!success) {
          callbacksRef.current.onDragEnd?.({
            pageX: e.absoluteX,
            pageY: e.absoluteY,
          });
        }
      });
    // Only `longPressMs` participates in the gesture's structure;
    // callbacks read through `callbacksRef` so they don't need to
    // invalidate the memo.
  }, [longPressMs]);

  // Real RN View between GestureDetector and the (likely RSD) child.
  // RNGH injects `collapsable={false}` into its immediate child so RN's
  // view-flattening optimization doesn't strip the measurement View it
  // attaches gestures to. RSD's strict prop whitelist rejects
  // `collapsable` ("invalid prop") and the inconsistent View hierarchy
  // that results makes gestures fire on the wrong native node — wrong
  // coords, dropped events, "stuck" board / "inconsistent" list.
  // Buffering with a plain View accepts the prop and stabilises the
  // hierarchy.
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  );
}
