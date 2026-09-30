// The Display controls on GTK: the viewer's language, default date format
// and formula syntax, as combo rows. The rows (their names, choices and
// notes) come from table-app's `displayChoices`, as the web's and macOS's
// do; only the drawing is here.

import type * as Adw from "@gtkx/gi/adw";
import { AdwComboRow, AdwPreferencesGroup } from "@gtkx/jsx/adw";
import type { DisplayChoiceRow, DisplaySettingKind } from "@workspace.sh/table-ui/shared";
import { StringList } from "./StringList.js";
import { useSelected } from "./useSelected.js";

function Row({ row, onChoose }: { row: DisplayChoiceRow; onChoose: (kind: DisplaySettingKind, value: string) => void }) {
  const at = Math.max(0, row.options.findIndex((o) => o.value === row.value));
  const labels = row.options.map((o) => o.label);
  const ref = useSelected<Adw.ComboRow>(at, labels.join("\u0000"));
  return (
    <AdwComboRow
      ref={ref}
      title={row.name}
      subtitle={row.note}
      accessibleDescription={row.label}
      model={<StringList strings={labels} />}
      selected={at}
      onNotifySelected={(index) => {
        if (index === null || index === at || !row.options[index]) return;
        onChoose(row.kind, row.options[index].value);
      }}
    />
  );
}

export interface DisplayControlsProps {
  rows: DisplayChoiceRow[];
  onChoose: (kind: DisplaySettingKind, value: string) => void;
}

export function DisplayControls({ rows, onChoose }: DisplayControlsProps) {
  return (
    <AdwPreferencesGroup title="Display" description="Yours alone: how tables are shown to you, never written into them.">
      {rows.map((row) => (
        <Row key={row.kind} row={row} onChoose={onChoose} />
      ))}
    </AdwPreferencesGroup>
  );
}
