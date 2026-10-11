// About This Field on GTK: what a column is, said in a dialog from its
// header's menu, with the way on to its settings. The facts are table-ui's
// fieldHint, the ones the Mac's inspector and the phone's ⓘ show for a
// selected cell and the web's header hint shows on hover.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { AdwDialog, AdwHeaderBar, AdwPreferencesGroup, AdwToolbarView } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkLabel } from "@gtkx/jsx/gtk";
import type { Field, TableSchema } from "@workspace.sh/table-core";
import { fieldHint, useDisplaySettings } from "@workspace.sh/table-ui/shared";
import { formulaAttributes } from "./FormulaEntry.js";
import { useDark } from "./theme.js";

export interface FieldAboutProps {
  field: Field | undefined;
  name: string;
  schema: TableSchema;
  /** Open the field's settings. Absent: the schema can't be edited here. */
  onSettings?: () => void;
  onClose: () => void;
}

export function FieldAbout({ field, name, schema, onSettings, onClose }: FieldAboutProps) {
  const { formulaSyntax } = useDisplaySettings();
  const dark = useDark();
  const hint = fieldHint({ field, name, schema, editable: false, formulaSyntax });
  return (
    <AdwDialog title={hint.title} contentWidth={420} onClosed={onClose}>
      <AdwToolbarView
        topBar={<AdwHeaderBar />}
        bottomBar={
          onSettings ? (
            <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12} halign={Gtk.Align.END}>
              <GtkButton label="Field Settings…" onClicked={onSettings} />
            </GtkBox>
          ) : undefined
        }
      >
        <GtkBox orientation={Gtk.Orientation.VERTICAL} marginStart={18} marginEnd={18} marginTop={6} marginBottom={18}>
          <AdwPreferencesGroup title="About This Field">
            <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={10}>
              <GtkLabel label={hint.facts.join(" · ")} xalign={0} wrap />
              {hint.description ? <GtkLabel label={hint.description} xalign={0} wrap /> : null}
              {hint.formula ? (
                <GtkLabel
                  label={hint.formula}
                  xalign={0}
                  wrap
                  cssClasses={["monospace"]}
                  attributes={Pango.AttrList.fromString(formulaAttributes(hint.formula, dark)) ?? undefined}
                />
              ) : null}
              {hint.storedAs ? <GtkLabel label={hint.storedAs} xalign={0} wrap cssClasses={["dim-label", "caption"]} /> : null}
            </GtkBox>
          </AdwPreferencesGroup>
        </GtkBox>
      </AdwToolbarView>
    </AdwDialog>
  );
}
