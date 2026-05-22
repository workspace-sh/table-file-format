/**
 * Native default — Metro resolves to this. Vite picks `.web.ts`.
 *
 * `Pressable` from `react-native` exposes onPressIn / onPressOut as
 * gesture lifecycle callbacks driven by RN's native responder system
 * (not React's synthetic-event tree). Critical on RN-macOS, where
 * synthetic mouseUp / pointerUp don't fire at the end of a press-
 * drag — only fresh clicks dispatch them. Pressable's onPressOut
 * fires reliably in both cases, with the release position in
 * `nativeEvent.pageX/pageY` for hit-testing.
 *
 * Web doesn't have this problem (real DOM dispatches mouseUp every
 * time), so the .web.ts variant just uses an html.div with
 * onMouseDown / onMouseUp / onTouchStart / onTouchEnd, normalising
 * the event shape so consumers don't need a platform branch.
 */
export { Pressable as DragPressable } from "react-native";
export type { GestureResponderEvent as DragPressEvent } from "react-native";
