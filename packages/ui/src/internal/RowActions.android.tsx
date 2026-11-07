/**
 * Android default: touch and hold a row for its actions in Material's
 * dropdown menu (Compose's, from @expo/ui), opening where the finger is,
 * each action with its Material Symbol and Delete in the error colour,
 * set apart by a divider, as iOS's menu has each action's SF Symbol and
 * Delete in red.
 * The hold is react-native-gesture-handler's, so it's recognised over a
 * cell that takes taps, and a scroll that starts first wins.
 */
import { useMemo, useRef, useState, type ReactElement } from "react";
import { View, type ImageSourcePropType } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { Box, DropdownMenu, DropdownMenuItem, HorizontalDivider, Host, Icon, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import type { RowActionsProps } from "../controlSlots";

// The actions' Material Symbols (controlSlots' rowActions and columnActions),
// weight 400, as vector drawables, which Compose's Icon draws.
const symbols: Record<string, ImageSourcePropType> = {
  arrow_range: require("./material/arrow_range.xml"),
  delete: require("./material/delete.xml"),
  description: require("./material/description.xml"),
  first_page: require("./material/first_page.xml"),
  grid_view: require("./material/grid_view.xml"),
  height: require("./material/height.xml"),
  info: require("./material/info.xml"),
  last_page: require("./material/last_page.xml"),
  note_add: require("./material/note_add.xml"),
  restart_alt: require("./material/restart_alt.xml"),
  select_all: require("./material/select_all.xml"),
  sticky_note_2: require("./material/sticky_note_2.xml"),
  vertical_align_bottom: require("./material/vertical_align_bottom.xml"),
  vertical_align_top: require("./material/vertical_align_top.xml"),
  visibility_off: require("./material/visibility_off.xml"),
};

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
  const colors = useMaterialColors();
  if (actions.length === 0) return children;
  const close = () => setAt(null);
  // A plain View between the detector and the (React Strict DOM) row, as
  // DragHandle has: RNGH sets collapsable on it, which RSD refuses.
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        // The same actions for VoiceOver and TalkBack, which don't touch and hold: the row's custom actions.
        accessibilityActions={actions.map((action) => ({ name: action.id, label: action.label }))}
        onAccessibilityAction={(e) => actions.find((action) => action.id === e.nativeEvent.actionName)?.onSelect()}
      >
        {children}
        {at && (
          <Host matchContents style={{ position: "absolute", left: at.x, top: at.y }}>
            <DropdownMenu expanded onDismissRequest={close}>
              <DropdownMenu.Trigger>
                <Box />
              </DropdownMenu.Trigger>
              <DropdownMenu.Items>
                {actions.flatMap((action, i) => {
                  const symbol = action.symbol?.material ? symbols[action.symbol.material] : undefined;
                  const tint = action.destructive ? colors.error : colors.onSurfaceVariant;
                  const item = (
                    <DropdownMenuItem
                      key={action.id}
                      elementColors={action.destructive ? { textColor: colors.error } : undefined}
                      onClick={() => {
                        close();
                        action.onSelect();
                      }}
                    >
                      {symbol && (
                        <DropdownMenuItem.LeadingIcon>
                          <Icon source={symbol} size={24} tint={tint} />
                        </DropdownMenuItem.LeadingIcon>
                      )}
                      <DropdownMenuItem.Text>
                        <Text>{action.label}</Text>
                      </DropdownMenuItem.Text>
                    </DropdownMenuItem>
                  );
                  // What removes something is set apart from the rest.
                  return action.destructive && i > 0 ? [<HorizontalDivider key={`${action.id}-divider`} />, item] : [item];
                })}
              </DropdownMenu.Items>
            </DropdownMenu>
          </Host>
        )}
      </View>
    </GestureDetector>
  );
}

RowActions.gesture = "Touch and hold a row";
