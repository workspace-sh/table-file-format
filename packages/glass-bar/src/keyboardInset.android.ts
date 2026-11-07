// Android, edge to edge: React Native's keyboard events give the keyboard's
// height without the navigation bar under it, so an editor docked on the
// keyboard by that height sits behind its top by the bar's height. This is
// that bar's height, to add (keyboardInset.ts: elsewhere nothing).
import { initialWindowMetrics } from "react-native-safe-area-context";

export function androidBarInset(): number {
  return initialWindowMetrics?.insets.bottom ?? 0;
}
