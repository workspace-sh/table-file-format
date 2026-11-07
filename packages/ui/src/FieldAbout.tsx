// About This Field where a column has no other place to say what it is
// (Android, from its header's menu): the platform's settings sheet, its
// facts as rows, and the ways on (its settings, its formula). The facts are
// fieldHint's, the ones GTK's About This Field, the Mac's inspector and the
// iPhone's ⓘ show, and the web's header hint shows on hover.

import type { ReactElement } from "react";

import { fieldAboutSections, type FieldAboutFacts } from "./fieldAboutRows";
import { usePlatformControls } from "./PlatformControls";

export interface FieldAboutProps extends FieldAboutFacts {
  onClose: () => void;
}

/** Null where the platform has no settings sheet of its own (the column's hint says it there). */
export function FieldAbout(props: FieldAboutProps): ReactElement | null {
  const { Sheet, SettingsForm } = usePlatformControls();
  if (!Sheet.presentsSettings || !SettingsForm) return null;
  return (
    <Sheet size="settings" title={props.hint.title} confirm={{ label: "Done", onPress: props.onClose }} dismissible onDismiss={props.onClose} fill>
      <SettingsForm sections={fieldAboutSections(props)} />
    </Sheet>
  );
}
