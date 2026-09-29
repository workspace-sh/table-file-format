/**
 * Where the native Select's menu goes (`Select.tsx`). Kept apart from
 * the component so it can be tested without a renderer.
 *
 * The menu opens below its button, as wide as its longest option but at
 * least as wide as the button, and is moved up or left only as far as it
 * takes to stay on screen. A list too long for the screen scrolls.
 */

/** One menu line: 13px text plus 6px above and below. */
export const ITEM_HEIGHT = 28;
export const MENU_PADDING = 4;
export const MENU_MAX = 320;
const GAP = 4;
const EDGE = 8;
/** Roughly one character of 13px system text. Only used to size the menu. */
const CHAR_WIDTH = 7;
/** The tick column and the padding either side. */
const CHROME_WIDTH = 44;
const MIN_WIDTH = 180;

export interface MenuPlacement {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function placeMenu(
  anchor: { top: number; left: number; width: number; height: number },
  labels: readonly string[],
  viewport: { width: number; height: number },
): MenuPlacement {
  const height = Math.min(labels.length * ITEM_HEIGHT + MENU_PADDING * 2, MENU_MAX, viewport.height - EDGE * 2);
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  const width = Math.min(
    Math.max(anchor.width, MIN_WIDTH, longest * CHAR_WIDTH + CHROME_WIDTH),
    viewport.width - EDGE * 2,
  );
  const below = anchor.top + anchor.height + GAP;
  return {
    top: Math.max(EDGE, Math.min(below, viewport.height - height - EDGE)),
    left: Math.max(EDGE, Math.min(anchor.left, viewport.width - width - EDGE)),
    width,
    height,
  };
}
