/**
 * Native default — Metro resolves to this; Vite picks `.web.ts`.
 *
 * The next layout eases from where things are to where they'll be, instead
 * of jumping: a card dropped on a board slides into its place, and the
 * columns, the board and what's below it in a document grow or shrink to
 * their new heights. iOS, Android and macOS (react-native-macos runs the
 * same layout animations).
 */
import { LayoutAnimation, Platform } from "react-native";

export function animateNextLayout(): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android" && Platform.OS !== "macos") return;
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
