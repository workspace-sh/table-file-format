/**
 * Web: the browser's own input type (a date picker for a date, a number
 * field for a number), and the attributes a phone's browser reads for its
 * keyboard. `inputAttributes.ts` serves React Native.
 */
import type { InputHints } from "../inputHints";
import { inputModeOf } from "../inputHints";

export function inputAttributes(hints: InputHints, type: string) {
  return {
    type,
    inputMode: inputModeOf(hints.kind),
    enterKeyHint: hints.enter,
    autoCapitalize: hints.autocapitalize,
    spellCheck: hints.autocorrect,
  };
}

/** The browser has nothing more to set. */
export function applyKeyboard(_el: unknown, _hints: InputHints): void {}

/** Puts the text being typed exactly where the value was shown: the web's input already is. */
export const cellInputFit = null;
