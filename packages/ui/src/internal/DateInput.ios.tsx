/**
 * iOS default: the system's compact date picker (SwiftUI's, from
 * @expo/ui) in the selected cell, opening the calendar (or the time
 * wheels) on a tap, as Calendar and Reminders do. A date and time shows
 * both. Typing on a selected cell still opens its text editor, so a typed
 * or pasted date still parses.
 */
import { DatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import type { DateInputProps, DateInputSlot } from "../controlSlots";
import { dateOfStored, storedOfDate } from "../dateEntry";

function DateInputView({ kind, value, onChange, label }: DateInputProps) {
  const selection = dateOfStored(kind, value) ?? new Date();
  return (
    <Host matchContents>
      <DatePicker
        title={label ?? ""}
        selection={selection}
        displayedComponents={kind === "date" ? ["date"] : kind === "time" ? ["hourAndMinute"] : ["date", "hourAndMinute"]}
        onDateChange={(date) => {
          const next = storedOfDate(kind, date);
          if (next !== value) onChange(next);
        }}
        modifiers={[datePickerStyle("compact"), labelsHidden()]}
      />
    </Host>
  );
}

export const DateInput: DateInputSlot = Object.assign(DateInputView, { available: true });
