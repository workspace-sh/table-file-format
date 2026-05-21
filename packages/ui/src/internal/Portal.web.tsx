/**
 * Web variant — Vite's resolve.extensions picks `.web.tsx` ahead of
 * `.tsx` so this file replaces the RN-Modal-based default when
 * bundling for the browser. No react-native dependency reaches the
 * web bundle.
 *
 * Uses React DOM's `createPortal` to render children directly under
 * `document.body`. That detaches them from the consuming component's
 * DOM ancestry, so any `overflow: hidden` / `transform` / `position`
 * parents don't clip them. Standard React pattern.
 *
 * SSR-safe: returns `null` when `document` is undefined (e.g. during
 * an SSR pass), so server-rendered HTML omits portal content. Hydrate
 * will render it once `document` is available.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
