/**
 * Native default — Metro on iOS/Android/macOS resolves to this when no
 * `.native.tsx` variant exists. Vite on web resolves to `Portal.web.tsx`
 * first.
 *
 * Renders children outside the normal component hierarchy so they
 * escape any clipping ancestor (e.g. a parent with `overflow: hidden`
 * for rounded corners). Used by the schema-field popover (so it can
 * extend past the table's clipping), the body-editor modal (so it
 * floats above everything), and the drag ghost (so it follows the
 * pointer regardless of which row's overflow it crosses).
 *
 * Backdrop / dismiss / animation behaviour is the consumer's concern —
 * Portal is intentionally a thin wrapper. Render whatever you need
 * inside, including a Pressable backdrop for outside-tap dismiss.
 *
 * On native we use RN's `Modal` primitive (already the standard
 * "render outside the navigation stack" mechanism on iOS / Android /
 * macOS). It's transparent + always-visible by design here — the
 * consumer mounts/unmounts the Portal to show/hide.
 */
import type { ReactNode } from "react";
import { Modal } from "react-native";

export interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  return (
    <Modal transparent visible animationType="none">
      {children}
    </Modal>
  );
}
