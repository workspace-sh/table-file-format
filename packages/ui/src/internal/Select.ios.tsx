/**
 * iOS default: the system's menu of choices (SwiftUI's Picker, from
 * @expo/ui), ticked at the chosen one, in Liquid Glass. Its button shows
 * the choice; or, given a `trigger` (a table cell's value), the trigger
 * itself opens the menu, so a selected cell's next tap chooses.
 *
 * iOS opens a menu only from a tap, so `focus()` does nothing here.
 */
import { forwardRef, useImperativeHandle } from "react";
import { Host, Menu, Picker, RNHostView, Text } from "@expo/ui/swift-ui";
import { disabled, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { SelectHandle, SelectProps, SelectSlot } from "../controlSlots";

export type { SelectHandle, SelectOption, SelectProps } from "../controlSlots";

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
    return (
      <Host matchContents>
        <Menu label={<RNHostView matchContents>{trigger}</RNHostView>}>
          <Picker label={label ?? ""} selection={value} onSelectionChange={choose} modifiers={[pickerStyle("inline")]}>
            {choices}
          </Picker>
        </Menu>
      </Host>
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
