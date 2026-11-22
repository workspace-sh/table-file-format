/**
 * iOS: the calendar's heading as a button, opening the system's month picker
 * in a popover from it, on Liquid Glass, as the bar's own popovers are.
 */
import { useState } from "react";
import { Button, DatePicker, Host, HStack, Image, Popover, Text } from "@expo/ui/swift-ui";
import { buttonStyle, datePickerStyle, font, foregroundStyle, frame, labelsHidden, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";

import type { CalendarJumpProps } from "../controlSlots";
import { dateOfStored, storedOfDate } from "../dateEntry";

export function CalendarJump({ title, detail, small, value, onChange }: CalendarJumpProps) {
  const [open, setOpen] = useState(false);
  const size = small ? 20 : 24;
  return (
    <Host matchContents>
      <Popover isPresented={open} onIsPresentedChange={setOpen} attachmentAnchor="bottom" arrowEdge="top">
        <Popover.Trigger>
          <Button onPress={() => setOpen(true)} modifiers={[buttonStyle("plain")]}>
            <HStack spacing={6}>
              <Text modifiers={[font({ size, weight: "bold" }), foregroundStyle("primary"), lineLimit(1)]}>{title}</Text>
              {detail ? <Text modifiers={[font({ size }), foregroundStyle("primary"), lineLimit(1)]}>{detail}</Text> : null}
              <Image systemName="chevron.down" size={13} modifiers={[foregroundStyle({ type: "hierarchical", style: "secondary" })]} />
            </HStack>
          </Button>
        </Popover.Trigger>
        <Popover.Content>
          <DatePicker
            title="Go to Date"
            selection={dateOfStored("date", value) ?? new Date()}
            displayedComponents={["date"]}
            onDateChange={(date) => {
              onChange(storedOfDate("date", date));
              setOpen(false);
            }}
            modifiers={[datePickerStyle("graphical"), labelsHidden(), frame({ width: 320 }), padding({ all: 8 })]}
          />
        </Popover.Content>
      </Popover>
    </Host>
  );
}
