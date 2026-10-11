/**
 * Native default (iOS, Android): no pointer hovers, so what shows on
 * hover elsewhere shows all along. macOS hovers (`hovers.macos.ts`); the
 * web asks the device (`@media (hover: none)`, `hovers.web.ts`).
 */
export const HOVERS = false;

/** Whether columns resize from their lines anywhere in the table (a fine pointer), not only the header's edge. Not on touch. */
export const RESIZE_BY_LINES = false;
