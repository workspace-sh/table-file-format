/**
 * iOS: the interface's colours are the system's (UIKit's semantic
 * colours, through PlatformColor), so they follow light and dark, Increase
 * Contrast, and the system's own tuning, as iOS apps' do.
 *
 * Each file keeps its palette as written, for the web and macOS. On iOS,
 * React Strict DOM's css.create returns plain objects that keep each
 * colour's light and dark pair; the pairs in SYSTEM_COLOR_ROLES
 * (systemColorRoles.ts), matched exactly, become the system colour that
 * plays the same role. Anything else, and choice pills, stay as written.
 */
import { PlatformColor } from "react-native";
import { swapSystemColors } from "../systemColorRoles";

/** Swap, in place, the colours of a css.create result for the system's. */
export function adoptSystemColors(styles: object): void {
  swapSystemColors(styles, (role) => PlatformColor(role));
}
