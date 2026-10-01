/**
 * Android default: Material's dropdown menu of choices (Compose's, from
 * @expo/ui), the chosen one ticked. Its button shows the choice; or,
 * given a `trigger` (a table cell's value), a tap on the trigger opens
 * the menu, so a selected cell's next tap chooses. `focus()` opens it.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Pressable, View } from "react-native";
import { Box, DropdownMenu, DropdownMenuItem, Host, Text, TextButton } from "@expo/ui/jetpack-compose";
import type { SelectHandle, SelectProps, SelectSlot } from "../controlSlots";

export type { SelectHandle, SelectOption, SelectProps } from "../controlSlots";

const SelectView = forwardRef<SelectHandle, SelectProps>(function Select({ value, options, onChange, onBlur, label, trigger }, ref) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => setOpen(true) }));
  const chosen = options.find((o) => o.value === value);
  const dismiss = () => {
    setOpen(false);
    onBlur?.();
  };
  const menu = (anchor: React.ReactNode) => (
    <DropdownMenu expanded={open} onDismissRequest={dismiss}>
      <DropdownMenu.Trigger>{anchor}</DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            enabled={!o.disabled}
            onClick={() => {
              setOpen(false);
              if (o.value !== value) onChange(o.value);
            }}
          >
            <DropdownMenuItem.Text>
              <Text>{o.label}</Text>
            </DropdownMenuItem.Text>
            {o.value === value && (
              <DropdownMenuItem.TrailingIcon>
                <Text>✓</Text>
              </DropdownMenuItem.TrailingIcon>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenu.Items>
    </DropdownMenu>
  );
  if (trigger) {
    // The menu opens under the trigger, from an empty anchor at its foot.
    return (
      <View collapsable={false}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)}>
          {trigger}
        </Pressable>
        {open && (
          <Host matchContents style={{ position: "absolute", left: 0, bottom: 0 }}>
            {menu(<Box />)}
          </Host>
        )}
      </View>
    );
  }
  return (
    <Host matchContents>
      {menu(
        <TextButton onClick={() => setOpen(true)}>
          <Text>{`${chosen?.label ?? ""} ▾`}</Text>
        </TextButton>,
      )}
    </Host>
  );
});

export const Select: SelectSlot = Object.assign(SelectView, { opensFromTrigger: true });
