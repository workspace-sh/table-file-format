/**
 * Pointer default (web: Metro tries `.macos` first on the Mac, which has its
 * own, and never `.ios`). Right-click a row for its actions in a menu where
 * the pointer is. iOS and Android have their own (`RowActions.ios.tsx`,
 * `RowActions.android.tsx`), and a host can pass another
 * (PlatformControlsProvider).
 *
 * Deleting lives here rather than as a control in every row, where it
 * would be clutter and easy to hit.
 */
import { cloneElement, useCallback, useState, type ReactElement } from "react";
import type { RowActionsProps } from "../controlSlots";
import { ActionsMenu } from "./ActionsMenu";

type ContextMenuEvent = { preventDefault: () => void; clientX: number; clientY: number };

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  if (actions.length === 0) return children;
  const row = cloneElement(children as ReactElement<{ onContextMenu?: (e: ContextMenuEvent) => void }>, {
    onContextMenu: (e: ContextMenuEvent) => {
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY });
    },
  });
  return (
    <>
      {row}
      {at && <ActionsMenu actions={actions} at={at} onClose={close} />}
    </>
  );
}

RowActions.gesture = "Right-click a row";
