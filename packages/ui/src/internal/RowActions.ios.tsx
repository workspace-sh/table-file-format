/**
 * iOS default: touch and hold a row for its actions in the system's
 * confirmation dialog (SwiftUI's, from @expo/ui), which iOS 26 anchors
 * where the finger is, Delete in red. The hold is
 * react-native-gesture-handler's, so it's recognised over a cell that
 * takes taps, and a scroll that starts first wins.
 *
 * Not a context menu around the row: that hosts the row inside SwiftUI
 * (RNHostView), and hosted rows lost their text (cells drawn blank or
 * half-clipped), so the row stays React Native and only the dialog is
 * SwiftUI.
 */
import { useMemo, useRef, useState, type ComponentProps, type ReactElement } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Button, ConfirmationDialog, Host, Text } from "@expo/ui/swift-ui";
import type { RowActionsProps } from "../controlSlots";

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // The gesture stays the same object across renders (see DragHandle):
  // it reads what to do through a ref.
  const open = useRef(setAt);
  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        .runOnJS(true)
        .maxDistance(15)
        .onStart((e) => open.current({ x: e.x, y: e.y })),
    [],
  );
  if (actions.length === 0) return children;
  const close = () => setAt(null);
  // A plain View between the detector and the (React Strict DOM) row, as
  // DragHandle has: RNGH sets collapsable on it, which RSD refuses.
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>
        {children}
        {at && (
          <Host style={{ position: "absolute", left: at.x, top: at.y, width: 1, height: 1 }}>
            <ConfirmationDialog
              title="Row"
              titleVisibility="hidden"
              isPresented
              onIsPresentedChange={(presented) => {
                if (!presented) close();
              }}
            >
              {/* Something for the dialog to be shown from: SwiftUI shows none from nothing. */}
              <ConfirmationDialog.Trigger>
                <Text> </Text>
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                {actions.map((action) => (
                  <Button
                    key={action.id}
                    label={action.label}
                    systemImage={action.symbol?.sf as ComponentProps<typeof Button>["systemImage"]}
                    role={action.destructive ? "destructive" : "default"}
                    onPress={() => {
                      close();
                      action.onSelect();
                    }}
                  />
                ))}
              </ConfirmationDialog.Actions>
            </ConfirmationDialog>
          </Host>
        )}
      </View>
    </GestureDetector>
  );
}

RowActions.gesture = "Touch and hold a row";
