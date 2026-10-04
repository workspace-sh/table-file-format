/**
 * iOS default: the system's menu of choices (SwiftUI's Picker, from
 * @expo/ui), ticked at the chosen one, in Liquid Glass. Its button shows
 * the choice; or, given a `trigger` (a table cell's value), the trigger
 * itself opens the menu, so a selected cell's next tap chooses.
 *
 * iOS opens a menu only from a tap, so `focus()` does nothing here.
 */
import { forwardRef, useImperativeHandle, type ComponentType, type ReactNode } from "react";
import { Host, Picker, Text } from "@expo/ui/swift-ui";
// react-native-ios-context-menu 3.2.1 ships without type declarations
// (see RowActions.ios.tsx): its props are typed here, for this file only.
// @ts-expect-error -- no type declarations in the published package
import { ContextMenuButton as UntypedContextMenuButton } from "react-native-ios-context-menu";
import { disabled, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { SelectHandle, SelectProps, SelectSlot } from "../controlSlots";

export type { SelectHandle, SelectOption, SelectProps } from "../controlSlots";

interface ContextMenuButtonProps {
  menuConfig: {
    menuTitle: string;
    menuItems: { actionKey: string; actionTitle: string; menuState?: "on" | "off"; menuAttributes?: "disabled"[] }[];
  };
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  isMenuPrimaryAction?: boolean;
  style?: object;
  children?: ReactNode;
}
const ContextMenuButton = UntypedContextMenuButton as ComponentType<ContextMenuButtonProps>;

const SelectView = forwardRef<SelectHandle, SelectProps>(function Select({ value, options, onChange, label, trigger }, ref) {
  useImperativeHandle(ref, () => ({ focus: () => {} }));
  const choices = options.map((o) => (
    <Text key={o.value} modifiers={[tag(o.value), ...(o.disabled ? [disabled(true)] : [])]}>
      {o.label}
    </Text>
  ));
  const choose = (next: string | number | null) => {
    if (next !== null && String(next) !== value) onChange(String(next));
  };
  if (trigger) {
    // UIKit's menu, opened by a tap on the trigger (a table cell), which
    // keeps its own size and takes the whole tap: a SwiftUI host would size
    // it to its text. The chosen one is ticked.
    return (
      <ContextMenuButton
        isMenuPrimaryAction
        style={{ alignSelf: "stretch", flexDirection: "row" }}
        menuConfig={{
          menuTitle: label ?? "",
          menuItems: options.map((o) => ({
            actionKey: o.value === "" ? "\u0000none" : o.value,
            actionTitle: o.label,
            ...(o.value === value ? { menuState: "on" as const } : {}),
            ...(o.disabled ? { menuAttributes: ["disabled" as const] } : {}),
          })),
        }}
        onPressMenuItem={({ nativeEvent }) => choose(nativeEvent.actionKey === "\u0000none" ? "" : nativeEvent.actionKey)}
      >
        {trigger}
      </ContextMenuButton>
    );
  }
  return (
    <Host matchContents>
      <Picker label={label ?? ""} selection={value} onSelectionChange={choose} modifiers={[pickerStyle("menu")]}>
        {choices}
      </Picker>
    </Host>
  );
});

export const Select: SelectSlot = Object.assign(SelectView, { opensFromTrigger: true });
