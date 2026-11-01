/**
 * Web: decided by the device in CSS (`@media (hover: none)` beside each
 * `:hover`), so nothing to decide here. Native has `hovers.ts`.
 */
export const HOVERS = true;

/**
 * With a mouse or trackpad, columns resize from their lines anywhere in
 * the table; on a touch screen, from the header's edge only, so a scroll
 * that starts near a line isn't taken for a resize.
 */
export const RESIZE_BY_LINES: boolean =
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
