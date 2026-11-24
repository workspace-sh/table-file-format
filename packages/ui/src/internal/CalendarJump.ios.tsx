/**
 * iOS: the calendar's heading as a button, opening the system's month picker
 * in a popover from it, on Liquid Glass, as the bar's own popovers are.
 */
import { useRef, useState } from "react";
import { Button, DatePicker, Host, HStack, Image, Popover, Text } from "@expo/ui/swift-ui";
import { buttonStyle, contentShape, datePickerStyle, font, foregroundStyle, frame, labelsHidden, lineLimit, padding, shapes } from "@expo/ui/swift-ui/modifiers";

import { choseADay } from "../calendar";
import type { CalendarJumpProps } from "../controlSlots";
import { dateOfStored, storedOfDate } from "../dateEntry";

/** How far the heading takes a tap beyond what it draws, about 45pt tall in all. Its margins take the room back. */
const TAP_MARGIN = 8;

export function CalendarJump({ title, detail, small, value, onChange }: CalendarJumpProps) {
  const [open, setOpen] = useState(false);
  // Where the month and year wheels have reached: the calendar follows when the picker closes.
  const [turnedTo, setTurnedTo] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const turn = (to: string | null) => {
    pending.current = to;
    setTurnedTo(to);
  };
  const presented = (next: boolean) => {
    setOpen(next);
    if (next) return;
    const reached = pending.current;
    turn(null);
    if (reached !== null && reached !== value) onChange(reached);
  };
  const size = small ? 20 : 24;
  return (
    // Its height set up front, its width (the month's name) matched: a host
    // matched in height too got it a few frames late, and the calendar's
    // heading grew under the page as it landed.
    <Host matchContents={{ horizontal: true }} alignment="leading" style={{ height: Math.ceil(size * 1.2) + 2 * TAP_MARGIN, marginVertical: -TAP_MARGIN, marginRight: -TAP_MARGIN }}>
      <Popover isPresented={open} onIsPresentedChange={presented} attachmentAnchor="bottom" arrowEdge="top">
        <Popover.Trigger>
          <Button onPress={() => setOpen(true)} modifiers={[buttonStyle("plain")]}>
            <HStack spacing={6} modifiers={[padding({ vertical: TAP_MARGIN, trailing: TAP_MARGIN }), contentShape(shapes.rectangle())]}>
              <Text modifiers={[font({ size, weight: "bold" }), foregroundStyle("primary"), lineLimit(1)]}>{title}</Text>
              {detail ? <Text modifiers={[font({ size }), foregroundStyle("primary"), lineLimit(1)]}>{detail}</Text> : null}
              <Image systemName="chevron.down" size={13} modifiers={[foregroundStyle({ type: "hierarchical", style: "secondary" })]} />
            </HStack>
          </Button>
        </Popover.Trigger>
        <Popover.Content>
          <DatePicker
            title="Go to Date"
            selection={dateOfStored("date", turnedTo ?? value) ?? new Date()}
            displayedComponents={["date"]}
            onDateChange={(date) => {
              const to = storedOfDate("date", date);
              if (!choseADay(turnedTo ?? value, to)) {
                turn(to);
                return;
              }
              turn(null);
              onChange(to);
              setOpen(false);
            }}
            modifiers={[datePickerStyle("graphical"), labelsHidden(), frame({ width: 320 }), padding({ all: 8 })]}
          />
        </Popover.Content>
      </Popover>
    </Host>
  );
}
