// What a field's typing wants from the keyboard, said once for every
// renderer: the kind of entry (a phone shows a number pad for a number,
// an @ for an email), whether to capitalise and correct, and what the
// return key says. Each toolkit maps it to its own: HTML's inputMode and
// friends on the web, React Native's keyboard types, GTK's input purpose.
// Free of any renderer, as shared.ts.

import type { Field } from "@workspace.sh/table-core";

export type InputHintKind =
  | "text"
  | "integer"
  | "decimal"
  /** A number that may be negative, whole or not: the keyboard needs a minus. */
  | "signed-decimal"
  | "email"
  | "url"
  | "phone"
  | "date"
  | "time"
  | "datetime";

export interface InputHints {
  kind: InputHintKind;
  autocapitalize: "none" | "sentences";
  autocorrect: boolean;
  /** The return key: "next" when typing goes on to another entry, else "done". */
  enter: "next" | "done";
}

/** How a field is typed. `then: "next"` when another entry follows (a form); a cell is "done". */
export function inputHints(field: Field | undefined, options: { then?: "next" | "done" } = {}): InputHints {
  const kind = hintKind(field);
  const prose = kind === "text";
  return { kind, autocapitalize: prose ? "sentences" : "none", autocorrect: prose, enter: options.then ?? "done" };
}

function hintKind(field: Field | undefined): InputHintKind {
  const unsigned = (field?.constraints?.minimum ?? -1) >= 0;
  switch (field?.type) {
    case "integer":
      return unsigned ? "integer" : "signed-decimal";
    case "number":
      return unsigned ? "decimal" : "signed-decimal";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "time":
      return "time";
    case "string":
      if (field.format === "email") return "email";
      if (field.format === "url") return "url";
      if (field.format === "phone") return "phone";
      return "text";
    default:
      return "text";
  }
}

/**
 * The HTML input attributes that say the same, for an `<input>` drawn by
 * the browser or by React Strict DOM, which hands `inputMode`,
 * `enterKeyHint`, `autoCapitalize` and `spellCheck` to React Native's
 * TextInput. HTML has no keyboard with a minus and a decimal point, so a
 * signed number asks for "text" here; a renderer that can do better
 * (React Native on iOS) does.
 */
export function inputModeOf(kind: InputHintKind): "text" | "numeric" | "decimal" | "email" | "url" | "tel" {
  switch (kind) {
    case "integer":
      return "numeric";
    case "decimal":
      return "decimal";
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}
