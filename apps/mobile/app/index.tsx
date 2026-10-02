// The table on screen, framed the platform's way: its view's name as the
// title, the views in a menu, the tables list and file actions in the
// toolbars (iOS) or the top app bar (Android, AndroidHeader), and search
// in the stack's search field. What's below is
// table-ui's views, scrolling under the glass bars.

import { useEffect, useMemo, useRef } from "react";
import { Platform, ScrollView } from "react-native";
import type { SFSymbol } from "expo-symbols";
import type { SearchBarCommands } from "react-native-screens";
import { Stack, useRouter } from "expo-router";
import { html, css } from "react-strict-dom";
import { isSheet, newId } from "@workspace.sh/table-core";
import { bundleOf, bundleTables, rowTitleFor, tableNameOf, viewCallbacks } from "@workspace.sh/table-app";
import { BodyEditor, PageGutter, PortalHost, ViewSettings, canInsertAt } from "@workspace.sh/table-ui";
import { useTableAppContext } from "../TableAppContext";
import { renderView } from "../renderView";
import { AndroidHeaderActions, AndroidTablesButton, type MaterialSymbol } from "../AndroidHeader";

// Horizontal page padding, and the negative margin that lets a sideways
// scroller run to the screen's edges.
const MOBILE_H_PADDING = 16;

export default function TableScreen() {
  const app = useTableAppContext();
  const router = useRouter();
  const tables = app?.state.tables;
  const bundles = app?.state.bundles;
  const active = app?.state.active;
  // The view on screen's callbacks, each an action (table-app's viewCallbacks).
  const callbacks = useMemo(
    () => (app ? viewCallbacks(app.state, app.dispatch, newId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, bundles, active],
  );
  // The toolbar's search field holds its own text: when the search clears
  // (leaving a view clears it), so does the field.
  const searchBar = useRef<SearchBarCommands>(null);
  const search = app?.state.search;
  useEffect(() => {
    if (search === "") searchBar.current?.clearText();
  }, [search]);
  // Development only: lets a script drive the app through React Native's
  // debugger connection, as the Mac's __tableDesktop does (taps can't be
  // sent from an agent's session). Not in release builds.
  useEffect(() => {
    if (!__DEV__ || !app) return;
    (globalThis as { __tableMobile?: unknown }).__tableMobile = {
      push: (path: "/tables") => router.push(path),
      back: () => router.back(),
      dispatch: app.dispatch,
      state: () => app.state,
    };
  });
  if (!app || !callbacks) return null;
  const { state, dispatch, derived, labelOf } = app;
  const { table, view, summary } = derived;
  const { view: shownView, rows: visibleRows, sheet } = derived.shown;
  const bundle = bundleOf(state.active);
  const showTables = () => router.push("/tables");
  const toggleSettings = () => dispatch({ type: "settings", open: !state.settingsOpen });
  // The same actions on both platforms, each with its system's symbol: SF
  // Symbols in iOS's toolbar menus, Material Symbols in Android's.
  const views: { key: string; label: string; sf?: SFSymbol; material?: MaterialSymbol; on?: boolean; onPress: () => void }[] = [
    ...table.views.map((v) => ({
      key: v.id,
      label: v.name,
      on: v.id === view.id,
      onPress: () => dispatch({ type: "showView", key: state.active, viewId: v.id }),
    })),
    { key: "new", label: "New View", sf: "plus", material: "add", onPress: () => dispatch({ type: "addView", id: newId() }) },
  ];
  const fileActions: { label: string; sf: SFSymbol; material: MaterialSymbol; onPress: () => void }[] = [
    {
      label: `New Table in ${state.bundles[bundle]?.title ?? bundle}`,
      sf: "tablecells.badge.ellipsis",
      material: "table",
      onPress: () => dispatch({ type: "create", making: { kind: "table", bundle } }),
    },
    { label: labelOf("new-file"), sf: "doc.badge.plus", material: "note_add", onPress: () => dispatch({ type: "create", making: { kind: "file" } }) },
    { label: labelOf("open-zip"), sf: "folder", material: "folder_open", onPress: () => void app.openZip() },
    { label: labelOf("export-zip"), sf: "square.and.arrow.up", material: "share", onPress: () => void app.exportZip() },
  ];

  return (
    <>
      {/* The table first, before the bars' elements below: expo-router
          draws those as native views too, and UIKit collapses the large
          title only for a scroll view that comes first in the screen. */}
      <PageGutter.Provider value={MOBILE_H_PADDING}>
      <PortalHost>
        <ScrollView
          // Tracked by the large title, which collapses as it scrolls.
          contentInsetAdjustmentBehavior="automatic"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: MOBILE_H_PADDING, paddingBottom: 24 }}
          // The keyboard makes room rather than covering the cell being edited,
          // and a tap elsewhere while typing goes to what's tapped.
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
        >
          <html.span dir="auto" style={styles.place}>{derived.breadcrumb.text}</html.span>
          <html.div style={styles.subtitle}>
            <html.span>{summary.count}</html.span>
            <html.span>·</html.span>
            <html.span style={summary.valid ? styles.validityOk : styles.validityBad}>{summary.validity}</html.span>
            {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
            {summary.schemaChanged && <html.span style={styles.schemaBumpBadge}>{summary.schemaChangedLabel}</html.span>}
          </html.div>
          {state.settingsOpen && (
            <ViewSettings
              key={view.id}
              view={shownView}
              schema={table.schema}
              // Turning a Sheet view into anything else asks first (D41): the reducer's question.
              onChange={(patch) => dispatch({ type: "updateView", patch })}
              onArrange={(patch) => dispatch({ type: "arrange", patch })}
              personal={derived.arranged}
              onSaveForEveryone={() => dispatch({ type: "saveForEveryone" })}
              onReset={() => dispatch({ type: "resetArrangement" })}
              onDelete={table.views.length > 1 ? () => dispatch({ type: "deleteView" }) : undefined}
              onClose={() => dispatch({ type: "settings", open: false })}
              onCancel={() => dispatch({ type: "settings", open: false, revert: true })}
            />
          )}
          {renderView(shownView, visibleRows, table.schema, table.bodies, {
            ...callbacks,
            relatedTables: bundleTables(state.tables, bundle),
            allRows: table.rows,
            tableKey: tableNameOf(state.active),
            sheet,
            onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
          })}
        </ScrollView>
        {state.openPage && (
          <BodyEditor
            key={`${state.active}/${state.openPage}`}
            rowId={state.openPage}
            rowTitle={rowTitleFor(table, state.openPage)}
            content={table.bodies?.[state.openPage] ?? ""}
            onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
            onClose={() => dispatch({ type: "openPage", rowId: null })}
          />
        )}
      </PortalHost>
      </PageGutter.Provider>
      <Stack.Screen
        options={{
          title: view.name,
          // Android's actions are in the top app bar; iOS's in the toolbars below.
          ...(Platform.OS === "android" && {
            headerLeft: () => <AndroidTablesButton onPress={showTables} />,
            headerRight: () => (
              <AndroidHeaderActions
                views={views.map((v) => ({ label: v.label, icon: v.material, checked: v.on, onPress: v.onPress }))}
                settingsOpen={state.settingsOpen}
                onSettings={toggleSettings}
                more={fileActions.map((a) => ({ label: a.label, icon: a.material, onPress: a.onPress }))}
              />
            ),
          }),
        }}
      />
      {Platform.OS === "ios" && (
        <>
          {/* The tables, in a sheet of their own. */}
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel="Tables" onPress={showTables} />
          </Stack.Toolbar>
          {/* This table's views, and a new one. */}
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Menu icon="rectangle.stack" accessibilityLabel="Views" title={table.meta.title ?? tableNameOf(state.active)}>
              {views.map((v) => (
                <Stack.Toolbar.MenuAction key={v.key} icon={v.sf} isOn={v.on} onPress={v.onPress}>
                  {v.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      )}
      <Stack.SearchBar
        ref={searchBar}
        placeholder="Search"
        onChangeText={(e: { nativeEvent: { text: string } }) => dispatch({ type: "search", text: e.nativeEvent.text })}
        // Cancel on iOS; closing the search field on Android.
        onCancelButtonPress={() => dispatch({ type: "search", text: "" })}
        onClose={() => dispatch({ type: "search", text: "" })}
      />
      {/* View settings, search, and the file actions, in the bottom toolbar. */}
      {Platform.OS === "ios" && (
        <Stack.Toolbar>
          <Stack.Toolbar.Button
            icon="slider.horizontal.3"
            accessibilityLabel="View Settings"
            selected={state.settingsOpen}
            onPress={toggleSettings}
          />
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.SearchBarSlot />
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
            {fileActions.map((a) => (
              <Stack.Toolbar.MenuAction key={a.label} icon={a.sf} onPress={a.onPress}>
                {a.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    </>
  );
}

const styles = css.create({
  // Where the view is, under the large title: its file and table.
  place: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 2,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  subtitle: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 12,
    marginBottom: 12,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  validityOk: {
    color: {
      default: "#1f7a2c",
      "@media (prefers-color-scheme: dark)": "#7ee08a",
    },
  },
  validityBad: {
    color: {
      default: "#c00",
      "@media (prefers-color-scheme: dark)": "#ff6b6b",
    },
  },
  schemaBumpBadge: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: {
      default: "#fef3c7",
      "@media (prefers-color-scheme: dark)": "#3f2e0a",
    },
    color: {
      default: "#92400e",
      "@media (prefers-color-scheme: dark)": "#fbbf24",
    },
  },
});
