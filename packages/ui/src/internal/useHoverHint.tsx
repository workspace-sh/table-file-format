/**
 * Native variant: a hover hint needs a pointer that hovers, which touch
 * screens don't have, so this adds nothing. Same shape as the web variant
 * (`useHoverHint.web.tsx`) so callers don't branch.
 */
import type { ReactNode } from "react";

export interface HoverHint {
  /** Spread onto the element the hint belongs to. */
  props: Record<string, unknown>;
  /** Render anywhere; it portals itself. */
  element: ReactNode;
}

export function useHoverHint(_hint: ReactNode, _options: { delayMs?: number } = {}): HoverHint {
  return { props: {}, element: null };
}
