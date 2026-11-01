/**
 * The default mark beside a row's title that says it has a page
 * (PlatformControls.PageMark). Here (web, macOS, Android) none: the views
 * draw the word "page" in a chip. iOS draws the system's page symbol
 * (PageMark.ios.tsx).
 */
import type { PageMarkSlot } from "../controlSlots";

export const PageMark: PageMarkSlot | null = null;
