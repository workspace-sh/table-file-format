/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.tsx` variant exists. Vite on web resolves to `Portal.web.tsx`
 * first.
 *
 * Previously wrapped children in RN's `Modal`. That crashes on
 * RN-macOS at construction ("Exception in HostFunction" inside
 * ReactFabric createNode), so every macOS surface touching Portal —
 * body editor, schema-field popover, drag ghost — blew up. iOS and
 * Android worked, but having one mechanism that works everywhere
 * beats case-splitting macOS.
 *
 * The replacement delegates to `HostedPortal`, a context-based portal
 * host that mounts portaled children into a single root-level slot.
 * Apps mount `<PortalHost>` near the app root to enable this.
 */
import type { ReactNode } from "react";
import { HostedPortal } from "./PortalHost";

export interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  return <HostedPortal>{children}</HostedPortal>;
}
