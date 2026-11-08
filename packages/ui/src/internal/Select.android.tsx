/**
 * Android default: Material 3 Expressive's menu of choices (Compose's
 * DropdownMenuPopup, from @expo/ui), the chosen one selected and ticked. Its button shows the choice; or,
 * given a `trigger` (a table cell's value), a tap on the trigger opens
 * the menu, so a selected cell's next tap chooses. `focus()` opens it.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Pressable, View } from "react-native";
import { Box, DropdownMenuGroup, DropdownMenuPopup, Host, Icon, SelectableDropdownMenuItem, Text, TextButton } from "@expo/ui/jetpack-compose";
import type { SelectHandle, SelectProps, SelectSlot } from "../controlSlots";

export type { SelectHandle, SelectOption, SelectProps } from "../controlSlots";

/** The chosen one's mark: Material Symbols' check, weight 400. */
const CHECK = require("./material/check.xml");

const SelectView = forwardRef<SelectHandle, SelectProps>(function Select({ value, options, onChange, onBlur, label, trigger }, ref) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => setOpen(true) }));
  const chosen = options.find((o) => o.value === value);
  const dismiss = () => {
    setOpen(false);
    onBlur?.();
  };
  // Material 3 Expressive's menu, hung from its anchor: the choices one rounded group, the chosen one selected.
  const menu = (anchor: React.ReactNode) => (
    <Box>
      {anchor}
      <DropdownMenuPopup expanded={open} onDismissRequest={dismiss}>
        <DropdownMenuGroup>
          {options.map((o, i) => (
            <SelectableDropdownMenuItem
              key={o.value}
              selected={o.value === value}
              shapes={{ index: i, count: options.length }}
              enabled={!o.disabled}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
            >
              <SelectableDropdownMenuItem.Text>
                <Text>{o.label}</Text>
              </SelectableDropdownMenuItem.Text>
              <SelectableDropdownMenuItem.SelectedLeadingIcon>
                <Icon source={CHECK} size={24} />
              </SelectableDropdownMenuItem.SelectedLeadingIcon>
            </SelectableDropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuPopup>
    </Box>
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
