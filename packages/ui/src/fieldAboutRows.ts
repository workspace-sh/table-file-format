// About This Field's rows (FieldAbout), apart from drawing them.

import type { SettingsRow, SettingsSection } from "./controlSlots";
import type { FieldHintFacts } from "./fieldHintFacts";

export interface FieldAboutFacts {
  hint: FieldHintFacts;
  /** The field's stored key, said when its title differs. */
  name: string;
  /** Open the field's settings. Absent: the schema can't be changed here. */
  onSettings?: () => void;
  /** A formula column's formula, opened in the editor for a row. */
  onEditFormula?: () => void;
}

/** The sheet's sections, apart from drawing them (tested). */
export function fieldAboutSections({ hint, name, onSettings, onEditFormula }: FieldAboutFacts): SettingsSection[] {
  const [kind, ...more] = hint.facts;
  const facts: SettingsRow[] = [
    { kind: "info", id: "kind", label: "Kind", value: kind ?? "" },
    ...(more.length > 0 ? [{ kind: "info" as const, id: "details", label: "Details", value: more.join(" · ") }] : []),
    ...(hint.description ? [{ kind: "info" as const, id: "description", label: "Description", value: hint.description }] : []),
    ...(hint.formula ? [{ kind: "info" as const, id: "formula", label: "Formula", value: hint.formula }] : []),
    ...(hint.storedAs ? [{ kind: "info" as const, id: "stored-as", label: "Stored as", value: name }] : []),
  ];
  const ways: SettingsRow[] = [
    ...(hint.formula && onEditFormula ? [{ kind: "action" as const, id: "edit-formula", label: "Edit Formula…", onPress: onEditFormula }] : []),
    ...(onSettings ? [{ kind: "action" as const, id: "settings", label: "Field Settings…", onPress: onSettings }] : []),
  ];
  return [{ id: "about", title: "About This Field", rows: facts }, ...(ways.length > 0 ? [{ id: "ways", rows: ways }] : [])];
}

