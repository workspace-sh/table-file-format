// The inspector: the window's trailing pane, for what's selected. A row's
// page is written here, the view's settings are changed here, and a
// selected cell says what it is and is where its formula is written. It is the system's inspector (TableShell.swift),
// so it has the pane's own material and place under the toolbar; this is
// only what goes in it.
import { useSyncExternalStore, type ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { GlassBar } from "@workspace.sh/glass-bar";
import { BodyEditor, DisplaySettingsProvider, PanelSurface, PlatformControlsProvider, PortalHost, ViewSettings } from "@workspace.sh/table-ui";
import type { PlatformControls, SheetProps } from "@workspace.sh/table-ui/shared";
import { html, css } from "react-strict-dom";
import { macControls } from "./MacControls";
import { MacSettingsForm, macSheet } from "./MacSettings";
import { inspectorStore } from "./inspectorStore";

/**
 * table-ui's sheet, as the inspector has it: no card and no dimming, just
 * its title, what it holds, and its buttons along the foot.
 */
function InspectorSheet({ title, subtitle, cancel, confirm, status, children }: SheetProps): ReactElement {
  return (
    <html.div style={styles.sheet}>
      <html.div style={styles.header}>
        <html.span style={styles.title}>{title}</html.span>
        {subtitle !== undefined && <html.span style={styles.subtitle}>{subtitle}</html.span>}
      </html.div>
      {children}
      <html.div style={styles.footer}>
        <html.span style={styles.subtitle}>{status}</html.span>
        <html.div style={styles.buttons}>
          {cancel && (
            <html.button style={styles.button} onClick={cancel.onPress}>
              {cancel.label}
            </html.button>
          )}
          {confirm && (
            <html.button disabled={confirm.disabled} style={[styles.button, styles.primary]} onClick={confirm.onPress}>
              {confirm.label}
            </html.button>
          )}
        </html.div>
      </html.div>
    </html.div>
  );
}

/**
 * The window's controls, for both of its React views: the Mac's menus and
 * date picker, settings as the inspector's own form, and a row's page in
 * the inspector's sheet.
 */
export const windowControls: Partial<PlatformControls> = {
  ...macControls,
  Sheet: macSheet(InspectorSheet),
  SettingsForm: MacSettingsForm,
};
/** The page is written on the pane's own material, so its field has no fill of its own. */
const OnPane = ({ children }: { children: React.ReactNode }) => <>{children}</>;

/** The view's settings, a fresh form for each view. */
function SettingsOf({ settings }: { settings: NonNullable<ReturnType<typeof inspectorStore.get>["settings"]> }) {
  const { key, ...props } = settings;
  return <ViewSettings key={key} {...props} />;
}

export function Inspector() {
  const { page, settings, cell, cellRef, display } = useSyncExternalStore(inspectorStore.subscribe, inspectorStore.get);
  const dark = useColorScheme() === "dark";
  const body = page ? (
    <PanelSurface.Provider value={OnPane}>
      <BodyEditor key={page.key} rowId={page.rowId} rowTitle={page.rowTitle} content={page.content} onSave={page.onSave} onClose={page.onClose} />
    </PanelSurface.Provider>
  ) : settings ? (
    // The view's settings change as they're made, beside the view they change.
    // Drawn by the inspector's own form (MacSettings.tsx); this only describes them.
    <SettingsOf settings={settings} />
  ) : cell && cell.state.kind === "selected" ? (
    // Said in the system's form, over this view (TableCellInspector.swift).
    <View />
  ) : cell && cell.state.kind === "editing" ? (
    <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
      <GlassBar {...cell} ref={cellRef as never} />
    </ScrollView>
  ) : (
    <View style={native.empty}>
      <Text style={[native.emptyText, { color: dark ? "#8a8a93" : "#6e6e73" }]}>Select a cell or open a row's page</Text>
    </View>
  );
  return (
    <PortalHost>
      <PlatformControlsProvider value={windowControls}>
        <DisplaySettingsProvider value={display ?? {}}>{body}</DisplaySettingsProvider>
      </PlatformControlsProvider>
    </PortalHost>
  );
}

const native = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 13, textAlign: "center" },
});

const styles = css.create({
  // Fills the pane by its edges (it's the first thing in it, with no flex parent to grow in).
  sheet: { display: "flex", flexDirection: "column", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  header: { display: "flex", flexDirection: "column", gap: 2, paddingInline: 16, paddingBlock: 12 },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  subtitle: {
    fontSize: 11,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 16,
    paddingBlock: 12,
  },
  buttons: { display: "flex", flexDirection: "row", gap: 8 },
  button: {
    paddingInline: 12,
    paddingBlock: 5,
    fontSize: 13,
    borderRadius: 7,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#c7c7cc", "@media (prefers-color-scheme: dark)": "#48484d" },
    backgroundColor: "transparent",
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  primary: { backgroundColor: "#0a84ff", borderColor: "#0a84ff", color: "#ffffff" },
});
