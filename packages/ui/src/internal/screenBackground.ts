/**
 * The colour the views are drawn to sit on, for a host to give the screen
 * behind them: their sticky bands and cards are painted in it, so a screen
 * of another colour shows round them. Here (web, macOS, Android) undefined:
 * the page's own. iOS: the system background (screenBackground.ios.ts).
 */
import type { ColorValue } from "react-native";

export const screenBackground: ColorValue | undefined = undefined;
