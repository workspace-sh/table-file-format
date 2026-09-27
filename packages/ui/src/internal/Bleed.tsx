/**
 * Native variant — Metro picks this. Vite picks `Bleed.web.tsx`.
 *
 * On native the screen sets its own margins and scroll views already
 * reach its edges, so there is nothing to bleed: these pass through.
 */
import type { ReactNode } from "react";

export function Bleed({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function GutterSpacer(_props: { gap?: number }) {
  return null;
}
