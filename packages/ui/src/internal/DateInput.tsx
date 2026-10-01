/**
 * Default (web, macOS): unavailable. A date is typed in the cell's editor
 * (the web's own date input, or text that parses), so the views never draw
 * this. iOS and Android have `DateInput.ios.tsx` and `DateInput.android.tsx`.
 */
import type { DateInputProps, DateInputSlot } from "../controlSlots";

function DateInputView({ trigger }: DateInputProps) {
  return trigger;
}

export const DateInput: DateInputSlot = Object.assign(DateInputView, { available: false });
