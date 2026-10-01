/**
 * Android default: a tap on the selected cell opens Material's date
 * dialog (Compose's, from @expo/ui), its time dialog for a time, and the
 * one then the other for a date and time.
 */
import { useState } from "react";
import { Pressable } from "react-native";
import { DatePickerDialog, Host, TimePickerDialog } from "@expo/ui/jetpack-compose";
import type { DateInputProps, DateInputSlot } from "../controlSlots";
import { dateOfStored, storedOfDate } from "../dateEntry";

function DateInputView({ kind, value, onChange, label, trigger }: DateInputProps) {
  // Which dialog is open; a date and time keeps the day picked before its time.
  const [step, setStep] = useState<null | "date" | "time">(null);
  const [day, setDay] = useState<Date | null>(null);
  const current = dateOfStored(kind, value);
  const close = () => {
    setStep(null);
    setDay(null);
  };
  const store = (date: Date) => {
    const next = storedOfDate(kind, date);
    if (next !== value) onChange(next);
  };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setStep(kind === "time" ? "time" : "date")}>
        {trigger}
      </Pressable>
      {step && (
        <Host matchContents>
          {step === "date" ? (
            <DatePickerDialog
              // Material's day is its UTC midnight.
              initialDate={current ? `${storedOfDate("date", current)}T00:00:00Z` : null}
              onDateSelected={(date) => {
                const picked = new Date(date);
                if (kind === "date") {
                  const next = storedOfDate("date", picked, "utc");
                  if (next !== value) onChange(next);
                  close();
                } else {
                  setDay(picked);
                  setStep("time");
                }
              }}
              onDismissRequest={close}
            />
          ) : (
            <TimePickerDialog
              initialDate={(current ?? new Date()).toISOString()}
              onDateSelected={(time) => {
                const t = new Date(time);
                if (kind === "time" || !day) store(t);
                else {
                  // The day as picked (UTC midnight), at the time picked, in the viewer's time.
                  store(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.getHours(), t.getMinutes()));
                }
                close();
              }}
              onDismissRequest={close}
            />
          )}
        </Host>
      )}
    </>
  );
}

export const DateInput: DateInputSlot = Object.assign(DateInputView, { available: true });
