// The table on screen, framed the platform's way: its view's name as the
// large title, the views in a menu, the tables list and file actions in
// the toolbars, and search in the toolbar's search field. What's below is
// table-ui's views, scrolling under the glass bars.

import { useEffect, useMemo, useRef } from "react";
import { ScrollView } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { Stack, useRouter } from "expo-router";
import { html, css } from "react-strict-dom";
import { isSheet, newId } from "@workspace.sh/table-core";
import { bundleOf, bundleTables, rowTitleFor, tableNameOf, viewCallbacks } from "@workspace.sh/table-app";
import { BodyEditor, PortalHost, ViewSettings, canInsertAt } from "@workspace.sh/table-ui";
import { useTableAppContext } from "../TableAppContext";
import { renderView } from "../renderView";

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

  return (
    <>
      <Stack.Screen options={{ title: view.name }} />
      {/* The tables, in a sheet of their own. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel="Tables" onPress={() => router.push("/tables")} />
      </Stack.Toolbar>
      {/* This table's views, and a new one. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="rectangle.stack" accessibilityLabel="Views" title={table.meta.title ?? tableNameOf(state.active)}>
          {table.views.map((v) => (
            <Stack.Toolbar.MenuAction
              key={v.id}
              isOn={v.id === view.id}
              onPress={() => dispatch({ type: "showView", key: state.active, viewId: v.id })}
            >
              {v.name}
            </Stack.Toolbar.MenuAction>
          ))}
          <Stack.Toolbar.MenuAction icon="plus" onPress={() => dispatch({ type: "addView", id: newId() })}>
            New View
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.SearchBar
        ref={searchBar}
        placeholder="Search"
        onChangeText={(e: { nativeEvent: { text: string } }) => dispatch({ type: "search", text: e.nativeEvent.text })}
        onCancelButtonPress={() => dispatch({ type: "search", text: "" })}
      />
      {/* View settings, search, and the file actions, in the bottom toolbar. */}
      <Stack.Toolbar>
        <Stack.Toolbar.Button
          icon="slider.horizontal.3"
          accessibilityLabel="View Settings"
          selected={state.settingsOpen}
          onPress={() => dispatch({ type: "settings", open: !state.settingsOpen })}
        />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon="tablecells.badge.ellipsis"
            onPress={() => dispatch({ type: "create", making: { kind: "table", bundle } })}
          >
            {`New Table in ${state.bundles[bundle]?.title ?? bundle}`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="doc.badge.plus" onPress={() => dispatch({ type: "create", making: { kind: "file" } })}>
            {labelOf("new-file")}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => void app.openZip()}>
            {labelOf("open-zip")}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.arrow.up" onPress={() => void app.exportZip()}>
            {labelOf("export-zip")}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <PortalHost>
        <ScrollView
          // First in the screen, so the large title collapses as it scrolls.
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
            rowId={state.openPage}
            rowTitle={rowTitleFor(table, state.openPage)}
            content={table.bodies?.[state.openPage] ?? ""}
            onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content })}
            onClose={() => dispatch({ type: "openPage", rowId: null })}
          />
        )}
      </PortalHost>
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
