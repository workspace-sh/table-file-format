/**
 * Native default — Metro on iOS / Android / macOS resolves to this when
 * no `.native.tsx` variant exists. Vite on web resolves to
 * `Portal.web.tsx` first.
 *
 * Previously this wrapped children in RN's `Modal` primitive, which
 * worked on iOS / Android but crashed on RN-macOS at construction
 * (`createNode` → "Exception in HostFunction"). The replacement uses
 * a context-based portal-host pattern (`PortalHost`) that works
 * uniformly across all three platforms — no Modal involved.
 *
 * Apps consuming this need to mount `<PortalHost>` near the root for
 * the portal to actually escape clipping. If no host is mounted the
 * Portal falls back to rendering inline (visible, but no clipping
 * escape — see HostedPortal for details).
 */
import type { ReactNode } from "react";
import { HostedPortal } from "./PortalHost";

export interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  return <HostedPortal>{children}</HostedPortal>;
}
