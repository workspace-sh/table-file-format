/**
 * iOS: the system's segmented control for the range, and its glass buttons
 * for Previous, Today and Next (SwiftUI, from @expo/ui).
 */
import { Button, Host, HStack, Picker, Text } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, labelStyle, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";

import type { CalendarControlsProps } from "../controlSlots";

export function CalendarControls({ range, onRange, canPrevious, canNext, canToday, onPrevious, onNext, onToday }: CalendarControlsProps) {
  return (
    <Host matchContents>
      <HStack spacing={8}>
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
        <Button label="Previous" systemImage="chevron.backward" onPress={onPrevious} modifiers={[buttonStyle("glass"), labelStyle("iconOnly"), disabled(!canPrevious)]} />
        <Button label="Today" onPress={onToday} modifiers={[buttonStyle("glass"), disabled(!canToday)]} />
        <Button label="Next" systemImage="chevron.forward" onPress={onNext} modifiers={[buttonStyle("glass"), labelStyle("iconOnly"), disabled(!canNext)]} />
      </HStack>
    </Host>
  );
}
