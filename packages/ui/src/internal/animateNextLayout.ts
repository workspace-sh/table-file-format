/**
 * Native default — Metro resolves to this; Vite picks `.web.ts`.
 *
 * The next layout eases from where things are to where they'll be, instead
 * of jumping: a card dropped on a board slides into its place, and the
 * columns, the board and what's below it in a document grow or shrink to
 * their new heights. iOS and Android only; react-native-macos isn't asked.
 */
import { LayoutAnimation, Platform } from "react-native";

export function animateNextLayout(): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
