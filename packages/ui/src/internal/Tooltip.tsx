/**
 * A native tooltip around `children`, where the platform draws one on
 * hover. Here (web, iOS, Android) it adds nothing, not even an element:
 * the web shows its own hover hint (useHoverHint.web.tsx), and touch
 * screens have no hover. macOS draws AppKit's (Tooltip.macos.tsx).
 */
import type { ReactNode } from "react";

export function Tooltip({ children }: { text?: string; children: ReactNode }) {
  return children;
}
