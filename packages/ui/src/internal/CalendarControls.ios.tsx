/**
 * iOS: the system's segmented control for the range, and its glass buttons
 * for Previous, Today and Next (SwiftUI, from @expo/ui).
 */
import { Button, Host, HStack, Picker, Text } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, disabled, labelStyle, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";

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
  const moves = (
    <>
      <Button label="Previous" systemImage="chevron.backward" onPress={onPrevious} modifiers={[buttonStyle("glass"), labelStyle("iconOnly"), controlSize("small"), disabled(!canPrevious)]} />
      <Button label="Today" onPress={onToday} modifiers={[buttonStyle("glass"), controlSize("small"), disabled(!canToday)]} />
      <Button label="Next" systemImage="chevron.forward" onPress={onNext} modifiers={[buttonStyle("glass"), labelStyle("iconOnly"), controlSize("small"), disabled(!canNext)]} />
    </>
  );
  // The range takes the page's width, as a segmented control does on a phone.
  if (part === "range") return <Host style={{ alignSelf: "stretch", height: 34 }}>{ranges}</Host>;
  if (part === "navigate") {
    return (
      <Host matchContents>
        <HStack spacing={6}>{moves}</HStack>
      </Host>
    );
  }
  return (
    <Host matchContents>
      <HStack spacing={8}>
        {ranges}
        {moves}
      </HStack>
    </Host>
  );
}
