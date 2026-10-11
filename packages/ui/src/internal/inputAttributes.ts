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
 * the TextInput itself, before it takes focus. On a Mac it turns off the
 * field's own focus ring instead.
 */
import { Platform } from "react-native";
import { css } from "react-strict-dom";
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

const fit = css.create({
  // A Mac's text field draws its text from the top of its box and two
  // points in; the value it replaces is centred in the row and flush.
  macos: { paddingBlockStart: 3, marginInlineStart: -2 },
});

/** Puts the text being typed exactly where the value was shown. */
export const cellInputFit = Platform.OS === "macos" ? fit.macos : null;

export function applyKeyboard(el: unknown, hints: InputHints): void {
  // RSD's ref is a copy of the element; the TextInput is behind getNativeRef (as focusInput).
  const input = el as { getNativeRef?: () => { setNativeProps?: (props: object) => void } | null } | null;
  if (Platform.OS === "macos") {
    // The cell being edited is already outlined: without this the field
    // draws the system's focus ring inside it (`outlineStyle: "none"`
    // doesn't reach a Mac's text field).
    input?.getNativeRef?.()?.setNativeProps?.({ enableFocusRing: false });
    return;
  }
  if (hints.kind !== "signed-decimal") return;
  const keyboardType = Platform.OS === "ios" ? "numbers-and-punctuation" : Platform.OS === "android" ? "numeric" : null;
  if (!keyboardType) return;
  input?.getNativeRef?.()?.setNativeProps?.({ keyboardType });
}
