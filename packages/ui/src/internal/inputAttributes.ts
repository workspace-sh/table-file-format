/**
 * Native default (iOS, Android, macOS; the web has
 * `inputAttributes.web.ts`). React Strict DOM hands `inputMode`,
 * `enterKeyHint`, `autoCapitalize` and `spellCheck` to TextInput, which
 * picks the keyboard from them. No `type`: RSD turns `type="number"` into
 * a digits-only pad, and has no date input.
 *
 * A number that may be negative needs a keyboard with a minus and a
 * decimal point, which no `inputMode` names: iOS's numbers and
 * punctuation, Android's signed number pad. `applyKeyboard` sets that on
 * the TextInput itself, before it takes focus.
 */
import { Platform } from "react-native";
import type { InputHints } from "../inputHints";
import { inputModeOf } from "../inputHints";

export function inputAttributes(hints: InputHints, _type: string) {
  return {
    inputMode: inputModeOf(hints.kind),
    enterKeyHint: hints.enter,
    autoCapitalize: hints.autocapitalize,
    spellCheck: hints.autocorrect,
  };
}

export function applyKeyboard(el: unknown, hints: InputHints): void {
  if (hints.kind !== "signed-decimal") return;
  const keyboardType = Platform.OS === "ios" ? "numbers-and-punctuation" : Platform.OS === "android" ? "numeric" : null;
  if (!keyboardType) return;
  // RSD's ref is a copy of the element; the TextInput is behind getNativeRef (as focusInput).
  const input = el as { getNativeRef?: () => { setNativeProps?: (props: object) => void } | null } | null;
  input?.getNativeRef?.()?.setNativeProps?.({ keyboardType });
}
