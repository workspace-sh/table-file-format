// The app's own settings on a phone, from the More menu: how dates,
// numbers and formulas are shown (the web's Display side), and starting
// again from the example tables. The rows are table-app's displayChoices,
// which every app draws; only the drawing is the phone's.

import { displayChoices } from "@workspace.sh/table-app";
import { usePlatformControls } from "@workspace.sh/table-ui";
import type { SettingsSection } from "@workspace.sh/table-ui/shared";
import { useTableAppContext } from "./TableAppContext";
import { BUILD_LABEL } from "./buildInfo";

export function AppSettings({ onClose }: { onClose: () => void }) {
  const app = useTableAppContext();
  const { Sheet, SettingsForm } = usePlatformControls();
  if (!app || !SettingsForm) return null;
  const { state, dispatch, systemLocale, resetDemo } = app;

  const sections: SettingsSection[] = [
    {
      // Which build this is, first, where it's seen as Settings opens: what
      // to quote when reporting something (docs/VERSIONING.md).
      id: "build",
      rows: [{ kind: "info", id: "build", label: "Build", value: BUILD_LABEL }],
    },
    ...displayChoices(state.display, systemLocale, "System").map(
      (row): SettingsSection => ({
        id: row.kind,
        footer: row.note,
        rows: [
          {
            kind: "choice",
            id: row.kind,
            label: row.name,
            value: row.value,
            options: row.options,
            onChange: (value) => dispatch({ type: "display", choice: { kind: row.kind, value } }),
          },
        ],
      }),
    ),
    {
      id: "demo",
      footer: "Edits are kept on this phone. Reset puts the example tables back as they shipped.",
      rows: [
        {
          kind: "action",
          id: "reset",
          label: "Reset Demo Data",
          role: "destructive",
          // Asked first, by the app (the same question as the web's); the sheet closes so the alert can show.
          onPress: () => {
            onClose();
            resetDemo();
          },
        },
      ],
    },
  ];

  return (
    <Sheet size="settings" title="Settings" confirm={{ label: "Done", onPress: onClose }} dismissible onDismiss={onClose} fill>
      <SettingsForm sections={sections} />
    </Sheet>
  );
}
