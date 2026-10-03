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
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, State } from "react-native-gesture-handler";

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
  /**
   * Render as a thin grab strip along one edge of the parent, instead
   * of wrapping `children` — the resize handle on a column's end edge
   * (the right, or the left in a right-to-left layout) or a row's bottom
   * edge. Wider than on web: it's for a finger.
   */
  edge?: "end" | "bottom";
  /** A double tap (a double click on macOS) on the handle, without dragging. */
  onDoubleTap?: () => void;
  /**
   * Take the touch as soon as it lands, before a scroll view around the
   * handle can: any movement drags, and a touch that ends where it began
   * is a tap. For a small handle that only shows while something is
   * selected, where a scroll that starts on it would only be a miss.
   */
  grabOnTouch?: boolean;
}

const edgeStyles = StyleSheet.create({
  end: { position: "absolute", top: 0, bottom: 0, end: 0, width: 12, zIndex: 2 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: -6, height: 12, zIndex: 2 },
});

export function DragHandle({
  children,
  onDragStart,
  onDragMove,
  onDragEnd,
  longPressMs,
  edge,
  onDoubleTap,
  grabOnTouch,
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
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd, onDoubleTap });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd, onDoubleTap };
  const doubleTaps = onDoubleTap !== undefined;

  const gesture = useMemo(() => {
    // Two taps within half a second (iOS's own double-tap interval) are
    // a double tap. Counted here because the gesture library's two-tap
    // recogniser failed between the taps inside a scroll view.
    const lastTap = { at: 0 };
    const tapped = () => {
      const now = Date.now();
      if (now - lastTap.at < 500) {
        lastTap.at = 0;
        callbacksRef.current.onDoubleTap?.();
      } else lastTap.at = now;
    };
    if (grabOnTouch) {
      const from = { x: 0, y: 0 };
      const active = { on: false };
      return Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          from.x = e.absoluteX;
          from.y = e.absoluteY;
          active.on = false;
        })
        .onStart(() => {
          active.on = true;
          callbacksRef.current.onDragStart?.({ pageX: from.x, pageY: from.y });
        })
        .onUpdate((e) => {
          callbacksRef.current.onDragMove?.({ pageX: e.absoluteX, pageY: e.absoluteY });
        })
        .onFinalize((e) => {
          if (active.on) callbacksRef.current.onDragEnd?.({ pageX: e.absoluteX, pageY: e.absoluteY });
          active.on = false;
          // A touch the system took back (a call, another view) isn't a tap.
          if (e.state !== State.CANCELLED && Math.hypot(e.absoluteX - from.x, e.absoluteY - from.y) < 4) tapped();
        });
    }
    let pan = Gesture.Pan()
      // Run callbacks on the JS thread, not as Reanimated worklets.
      // State updates flow through React; no Reanimated dependency.
      .runOnJS(true)
      // Without a long-press gate, a press only becomes a drag after a
      // few points of movement, so a tap still reaches the row or badge
      // underneath. With the gate, the hold itself is the signal.
      .minDistance(longPressMs && longPressMs > 0 ? 0 : 4);
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
    pan = pan
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
    if (!doubleTaps) return pan;
    // Whichever is first: a drag starts after a few points of movement,
    // and a tap ends without moving.
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) tapped();
      });
    return Gesture.Race(doubleTap, pan);
    // Only `longPressMs` and whether there's a double tap shape the
    // gesture; callbacks read through `callbacksRef` so they don't need
    // to invalidate the memo.
  }, [longPressMs, doubleTaps, grabOnTouch]);

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
      <View collapsable={false} style={edge ? edgeStyles[edge] : undefined}>
        {children}
      </View>
    </GestureDetector>
  );
}
