/**
 * Android default: touch and hold a row for its actions in Material 3
 * Expressive's menu (Compose's DropdownMenuPopup, from @expo/ui), opening
 * where the finger is, each action with its Material Symbol in a rounded
 * group, and Delete in the error colour in a group of its own, as iOS's
 * menu has each action's SF Symbol and Delete in red, set apart.
 * The hold is react-native-gesture-handler's, so it's recognised over a
 * cell that takes taps, and a scroll that starts first wins.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AppState, View, type ImageSourcePropType } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { Box, DropdownMenuGroup, DropdownMenuItem, DropdownMenuPopup, Host, Icon, Spacer, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import { height } from "@expo/ui/jetpack-compose/modifiers";
import type { RowActionsProps } from "../controlSlots";

/** Material's gap between a menu's groups, in dp (MenuDefaults.GroupSpacing). */
const GROUP_SPACING = 2;

// The actions' Material Symbols (controlSlots' rowActions and columnActions),
// weight 400, as vector drawables, which Compose's Icon draws.
const symbols: Record<string, ImageSourcePropType> = {
  arrow_range: require("./material/arrow_range.xml"),
  delete: require("./material/delete.xml"),
  description: require("./material/description.xml"),
  first_page: require("./material/first_page.xml"),
  function: require("./material/function.xml"),
  grid_view: require("./material/grid_view.xml"),
  height: require("./material/height.xml"),
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
  // An action chosen runs once the menu has gone and the screen has its window's focus back: the
  // menu is a window of its own, and Android shows no keyboard for a field focused in a window
  // without focus (Cell Formula… opens one).
  const chosen = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (at !== null || !chosen.current) return;
    const run = chosen.current;
    chosen.current = null;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(fallback);
      requestAnimationFrame(run);
    };
    const sub = AppState.addEventListener("focus", go);
    // A menu that never took the focus (TalkBack's actions, a menu already gone): it isn't waited for.
    const fallback = setTimeout(go, 400);
  }, [at]);
  const colors = useMaterialColors();
  if (actions.length === 0) return children;
  const close = () => setAt(null);
  // What removes something is set apart from the rest: a group of its own from there.
  const groups = actions.reduce<(typeof actions)[]>((all, action, i) => {
    if (i === 0 || action.destructive) all.push([]);
    all[all.length - 1].push(action);
    return all;
  }, []);
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
            <Box>
              <DropdownMenuPopup expanded onDismissRequest={close}>
                {groups.map((group, g) => (
                  <Fragment key={group[0].id}>
                    {g > 0 ? <Spacer modifiers={[height(GROUP_SPACING)]} /> : null}
                    <DropdownMenuGroup shapes={{ index: g, count: groups.length }}>
                      {group.map((action, i) => {
                        const symbol = action.symbol?.material ? symbols[action.symbol.material] : undefined;
                        const tint = action.destructive ? colors.error : colors.onSurfaceVariant;
                        return (
                          <DropdownMenuItem
                            key={action.id}
                            shape={{ index: i, count: group.length }}
                            elementColors={action.destructive ? { textColor: colors.error } : undefined}
                            onClick={() => {
                              chosen.current = action.onSelect;
                              close();
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
                      })}
                    </DropdownMenuGroup>
                  </Fragment>
                ))}
              </DropdownMenuPopup>
            </Box>
          </Host>
        )}
      </View>
    </GestureDetector>
  );
}

RowActions.gesture = "Touch and hold a row";
