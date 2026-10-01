/**
 * Android default: touch and hold a row for its actions in Material's
 * dropdown menu (Compose's, from @expo/ui), opening where the finger is.
 * The hold is react-native-gesture-handler's, so it's recognised over a
 * cell that takes taps, and a scroll that starts first wins.
 */
import { useMemo, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { Box, DropdownMenu, DropdownMenuItem, Host, Text } from "@expo/ui/jetpack-compose";
import type { RowActionsProps } from "../controlSlots";

// Material's error colour (M3 baseline), for an action that removes something.
const DESTRUCTIVE = "#B3261E";

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
        .onStart((e) => {
          // The hold is felt: the system's long-press feedback as it's recognised.
          void performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(() => {});
          open.current({ x: e.x, y: e.y });
        }),
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
          <Host matchContents style={{ position: "absolute", left: at.x, top: at.y }}>
            <DropdownMenu expanded onDismissRequest={close}>
              <DropdownMenu.Trigger>
                <Box />
              </DropdownMenu.Trigger>
              <DropdownMenu.Items>
                {actions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    elementColors={action.destructive ? { textColor: DESTRUCTIVE } : undefined}
                    onClick={() => {
                      close();
                      action.onSelect();
                    }}
                  >
                    <DropdownMenuItem.Text>
                      <Text>{action.label}</Text>
                    </DropdownMenuItem.Text>
                  </DropdownMenuItem>
                ))}
              </DropdownMenu.Items>
            </DropdownMenu>
          </Host>
        )}
      </View>
    </GestureDetector>
  );
}

RowActions.gesture = "Touch and hold a row";
