// Which of the views' colours play which interface role, and the swap
// that puts the platform's colour in their place (internal/systemColors.ios.ts
// uses it with PlatformColor). Free of any renderer, so it's tested in Node.

const DARK = "@media (prefers-color-scheme: dark)";

/**
 * "light/dark" as written in views.tsx → the iOS semantic colour for that
 * role. Matched exactly: a pair edited in views.tsx stops mapping, which
 * systemColorRoles.test.ts catches.
 */
export const SYSTEM_COLOR_ROLES: Readonly<Record<string, string>> = {
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

function swap(value: unknown, toColor: (role: string) => unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const pair = value as Record<string, unknown>;
  if (Object.keys(pair).length !== 2 || typeof pair.default !== "string" || typeof pair[DARK] !== "string") return value;
  const role = SYSTEM_COLOR_ROLES[`${pair.default.toLowerCase()}/${(pair[DARK] as string).toLowerCase()}`];
  return role ? toColor(role) : value;
}

function swapStyle(style: Record<string, unknown>, toColor: (role: string) => unknown): Record<string, unknown> {
  for (const prop of Object.keys(style)) style[prop] = swap(style[prop], toColor);
  return style;
}

/**
 * Swap, in place, the colours of a (native) css.create result: each known
 * pair becomes `toColor(role)`. Choice pills are data colours, not the
 * interface's, so styles named `pill…` are left alone.
 */
export function swapSystemColors(styles: object, toColor: (role: string) => unknown): void {
  const all = styles as Record<string, unknown>;
  for (const name of Object.keys(all)) {
    if (name.startsWith("pill")) continue;
    const style = all[name];
    if (typeof style === "function") {
      all[name] = (...args: unknown[]) => swapStyle(style(...args) as Record<string, unknown>, toColor);
    } else if (style && typeof style === "object") {
      swapStyle(style as Record<string, unknown>, toColor);
    }
  }
}
