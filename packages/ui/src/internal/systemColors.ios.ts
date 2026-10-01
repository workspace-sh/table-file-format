/**
 * iOS: the interface's colours are the system's (UIKit's semantic
 * colours, through PlatformColor), so they follow light and dark, Increase
 * Contrast, and the system's own tuning, as iOS apps' do.
 *
 * Each file keeps its palette as written, for the web and macOS. On iOS,
 * React Strict DOM's css.create returns plain objects that keep each
 * colour's light and dark pair; this swaps the pairs below, matched
 * exactly, for the system colour that plays the same role. Anything not
 * listed is left as written. Choice pills are data colours, not the
 * interface's, so styles named `pill…` are left alone.
 */
import { PlatformColor } from "react-native";

const DARK = "@media (prefers-color-scheme: dark)";

/** "light/dark" as written → the iOS semantic colour for that role. */
const ROLES: Record<string, string> = {
  "#1c1c1e/#f5f5f7": "label",
  "#6e6e73/#8a8a93": "secondaryLabel",
  "#8e8e93/#6e6e73": "tertiaryLabel",
  "#e5e5ea/#26262b": "separator",
  "#d1d1d6/#3a3a3f": "opaqueSeparator",
  "#f5f5f7/#17171a": "secondarySystemBackground",
  "#ffffff/#1c1c1e": "systemBackground",
  "#ffffff/#0e0e10": "systemBackground",
  "#3478f6/#0a84ff": "systemBlue",
  "#c00/#ff6b6b": "systemRed",
  "#1d4ed8/#8ab4ff": "link",
};

function swap(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const pair = value as Record<string, unknown>;
  const keys = Object.keys(pair);
  if (keys.length !== 2 || typeof pair.default !== "string" || typeof pair[DARK] !== "string") return value;
  const role = ROLES[`${pair.default.toLowerCase()}/${(pair[DARK] as string).toLowerCase()}`];
  return role ? PlatformColor(role) : value;
}

function swapStyle(style: Record<string, unknown>): Record<string, unknown> {
  for (const prop of Object.keys(style)) style[prop] = swap(style[prop]);
  return style;
}

/** Swap, in place, the colours of a css.create result for the system's. */
export function adoptSystemColors(styles: object): void {
  const all = styles as Record<string, unknown>;
  for (const name of Object.keys(all)) {
    if (name.startsWith("pill")) continue;
    const style = all[name];
    if (typeof style === "function") {
      all[name] = (...args: unknown[]) => swapStyle(style(...args) as Record<string, unknown>);
    } else if (style && typeof style === "object") {
      swapStyle(style as Record<string, unknown>);
    }
  }
}
