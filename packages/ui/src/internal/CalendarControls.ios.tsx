/**
 * iOS: the system's segmented control for the range, and its glass buttons
 * for Previous, Today and Next (SwiftUI, from @expo/ui).
 */
import { Button, Host, HStack, Picker, Text } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, frame, glassEffect, labelStyle, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";

import type { CalendarControlsProps } from "../controlSlots";

export function CalendarControls({ range, onRange, canPrevious, canNext, canToday, onPrevious, onNext, onToday, part }: CalendarControlsProps) {
  const ranges = (
    <Picker
      label="Range"
      selection={range}
      onSelectionChange={(next) => onRange(String(next) as CalendarControlsProps["range"])}
      modifiers={[pickerStyle("segmented")]}
    >
      <Text modifiers={[tag("month")]}>Month</Text>
      <Text modifiers={[tag("week")]}>Week</Text>
      <Text modifiers={[tag("agenda")]}>Agenda</Text>
    </Picker>
  );
  // One capsule, as a toolbar's group of buttons is, rather than three.
  const step = (can: boolean) => [buttonStyle("plain"), labelStyle("iconOnly"), frame({ width: 36, height: 36 }), disabled(!can)];
  const moves = (
    <HStack spacing={0} modifiers={[glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" })]}>
      <Button label="Previous" systemImage="chevron.backward" onPress={onPrevious} modifiers={step(canPrevious)} />
      <Button label="Today" onPress={onToday} modifiers={[buttonStyle("plain"), frame({ width: 54, height: 36 }), disabled(!canToday)]} />
      <Button label="Next" systemImage="chevron.forward" onPress={onNext} modifiers={step(canNext)} />
    </HStack>
  );
  // The range takes the page's width, as a segmented control does on a phone.
  if (part === "range") return <Host style={{ alignSelf: "stretch", height: 34 }}>{ranges}</Host>;
  // Sized up front: matched to its contents, the size came a few frames after
  // the first layout, and the heading's row grew under the page as it landed.
  if (part === "navigate") return <Host style={{ width: 36 + 54 + 36, height: 36 }}>{moves}</Host>;
  return (
    <Host matchContents>
      <HStack spacing={8}>
        {ranges}
        {moves}
      </HStack>
    </Host>
  );
}
