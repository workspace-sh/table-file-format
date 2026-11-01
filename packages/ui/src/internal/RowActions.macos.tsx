/**
 * macOS: right-click a row or a column's header for its actions, in the
 * same menu as the web's (ActionsMenu). React Strict DOM passes no
 * right-click to a native view, so the wrapper here is React Native's own
 * View, which react-native-macos tells of one through `onAuxClick` (button 2).
 */
import { useCallback, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";
import type { RowActionsProps } from "../controlSlots";
import { ActionsMenu } from "./ActionsMenu";
import { measureAnchor } from "./measureAnchor";

/** react-native-macos's mouse event: where in the view it was clicked, and with which button. */
type AuxClick = { nativeEvent: { clientX: number; clientY: number; button: number } };

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  if (actions.length === 0) return children;
  // Not in React Native's View types, which are iOS's: react-native-macos adds it.
  const aux = {
    onAuxClick: (e: AuxClick) => {
      if (e.nativeEvent.button !== 2) return;
      const { clientX, clientY } = e.nativeEvent;
      // The click is in the view's own coordinates; the menu is placed in the window's.
      void measureAnchor(ref.current).then((rect) => {
        if (rect) setAt({ x: rect.left + clientX, y: rect.top + clientY });
      });
    },
  };
  return (
    <>
      <View ref={ref} {...aux}>
        {children}
      </View>
      {at && <ActionsMenu actions={actions} at={at} onClose={close} />}
    </>
  );
}

RowActions.gesture = "Right-click a row";
