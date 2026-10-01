// table-ui/shared's inputHints as GTK says it: the entry's input purpose,
// which an on-screen keyboard reads (digits, a number with its point and
// sign, an email's @), and its hints, whether to correct and capitalise.

import * as Gtk from "@gtkx/gi/gtk";
import type { InputHints } from "@workspace.sh/table-ui/shared";

export function inputPurposeOf(hints: InputHints): Gtk.InputPurpose {
  switch (hints.kind) {
    case "integer":
      return Gtk.InputPurpose.DIGITS;
    case "decimal":
    case "signed-decimal":
      return Gtk.InputPurpose.NUMBER;
    case "email":
      return Gtk.InputPurpose.EMAIL;
    case "url":
      return Gtk.InputPurpose.URL;
    case "phone":
      return Gtk.InputPurpose.PHONE;
    default:
      return Gtk.InputPurpose.FREE_FORM;
  }
}

export function inputHintsOf(hints: InputHints): Gtk.InputHints {
  let flags = hints.autocorrect ? Gtk.InputHints.SPELLCHECK | Gtk.InputHints.WORD_COMPLETION : Gtk.InputHints.NO_SPELLCHECK;
  if (hints.autocapitalize === "sentences") flags |= Gtk.InputHints.UPPERCASE_SENTENCES;
  return flags as Gtk.InputHints;
}
