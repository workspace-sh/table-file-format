// The table on screen, framed the platform's way: its view's name as the
// title, the views in a menu, the tables list and file actions in the
// toolbars (iOS) or the top app bar (Android, AndroidHeader), and search
// in the stack's search field. What's below is
// table-ui's views, scrolling under the glass bars.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView } from "react-native";
import type { SFSymbol } from "expo-symbols";
import type { SearchBarCommands } from "react-native-screens";
import { Stack, useRouter } from "expo-router";
import { html, css } from "react-strict-dom";
import { isSheet, newId } from "@workspace.sh/table-core";
import type { Row } from "@workspace.sh/table-core";
import { asStored, bundleOf, bundleTables, ingestingText, readingText, rowTitleFor, tableNameOf, viewCallbacks } from "@workspace.sh/table-app";
import { BodyEditor, CellEditorContext, PageGutter, PageScrollContext, PortalHost, ViewSettings, canInsertAt, pageScrollOver } from "@workspace.sh/table-ui";
import type { PlaceMeasure } from "@workspace.sh/table-ui/shared";
import { GlassBar } from "@workspace.sh/glass-bar";
import { useTableAppContext } from "../TableAppContext";
import { renderView } from "../renderView";
import { MEASURING, openZipFrom, runMeasure, timeEdit } from "../measure";
import { AndroidHeaderActions, AndroidTablesButton, type MaterialSymbol } from "../AndroidHeader";
import { useGlassEditor } from "../useGlassEditor";
import { AppSettings } from "../AppSettings";

// Horizontal page padding, and the negative margin that lets a sideways
// scroller run to the screen's edges.
const MOBILE_H_PADDING = 16;
/** iOS: search, the selected cell and the editor are one glass control at the foot (#352). */
const GLASS = Platform.OS === "ios";
/** How many validation errors a tap on the count lists. */
const ERRORS_LISTED = 8;

/** The line under the navigation bar that "how far down" is measured at, in window points. */
const PLACE_LINE = 140;

const NO_ROWS: Row[] = [];

export default function TableScreen() {
  const app = useTableAppContext();
  const router = useRouter();
  // The app's own settings (display, reset), from the More menu.
  const [appSettings, setAppSettings] = useState(false);
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
  // The table's scroll position, so the editor can keep its cell in view.
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Where this screen is scrolled, for the table's rows: they are drawn
  // only where they're on screen (RowList.native.tsx).
  const page = useMemo(() => pageScrollOver(scroller), []);
  // How far down, kept for history as the row at a fixed line under the
  // navigation bar and how far into it: rows measured, not pixels, so it
  // survives rows drawn a window at a time.
  const measure = useRef<PlaceMeasure | null>(null);
  const onPlaceMeasure = useCallback((m: PlaceMeasure | null) => {
    measure.current = m;
  }, []);
  const notePlace = () => {
    const m = measure.current;
    if (!m || !app) return;
    void m.rowAt(PLACE_LINE).then((top) => {
      if (top) app.dispatch({ type: "place", place: { top } });
    });
  };
  // Gone back or forward to a view: scroll it to where it was left.
  const restoring = app?.state.restoring;
  useEffect(() => {
    if (!restoring) return;
    const top = restoring.place.top;
    // After the view has drawn the rows it was left at.
    const t = setTimeout(() => {
      if (!top) {
        scroller.current?.scrollTo({ y: 0, animated: false });
        return;
      }
      // Twice: the first move can collapse the large title, which shifts the rows; the second puts them right.
      const settle = (left: number) =>
        void measure.current?.topOf(top.rowId).then((at) => {
          if (at === null) return;
          const off = at + top.offset - PLACE_LINE;
          if (Math.abs(off) < 2) return;
          scroller.current?.scrollTo({ y: Math.max(0, scrollY.current + off), animated: false });
          if (left > 0) setTimeout(() => settle(left - 1), 120);
        });
      settle(2);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring?.n]);
  const glass = useGlassEditor({
    onScrollBy: (dy) => scroller.current?.scrollTo({ y: scrollY.current + dy, animated: true }),
    query: search ?? "",
    onQuery: (text) => app?.dispatch({ type: "search", text }),
    onFilter: () => app?.dispatch({ type: "settings", open: !app.state.settingsOpen }),
  });
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
      // Measuring large tables (#126): see measure.ts.
      openZipFrom: (url: string) => openZipFrom(url, app.openBytes),
      timeEdit: () => timeEdit(app.state, app.dispatch),
    };
  });
  // A measuring build (EXPO_PUBLIC_TABLE_MEASURE=1) opens what its local
  // server names, once, at launch (measure.ts).
  const measured = useRef(false);
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    if (!MEASURING || measured.current || !app) return;
    measured.current = true;
    void runMeasure(() => appRef.current!.state, app.dispatch, (path) => router.push(path as "/tables"), app.openBytes);
  });
  // Shaking the phone undoes, as iOS's own apps do: asked first, by what it
  // would undo. Only iOS has the shake (modules/table-files), so it's loaded there.
  const shake = useRef<{ ask?: () => void }>({});
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onShakeToUndo } = require("../modules/table-files") as typeof import("../modules/table-files");
    return onShakeToUndo(() => shake.current.ask?.());
  }, []);
  if (!app || !callbacks) return null;
  const { state, dispatch, derived, labelOf, indexed } = app;
  shake.current.ask = () => {
    const step = derived.canUndo ? ("undo" as const) : derived.canRedo ? ("redo" as const) : null;
    if (!step) return;
    Alert.alert(labelOf(step), undefined, [
      { text: "Cancel", style: "cancel" },
      { text: step === "undo" ? "Undo" : "Redo", onPress: () => dispatch({ type: step }) },
    ]);
  };
  const { table, view, summary } = derived;
  const { view: shownView, rows: visibleRows, sheet } = derived.shown;
  // The rows of a large table still being read, shown until its own view's rows are here.
  const reading = view.layout === "table" && !indexed.source ? indexed.reading : undefined;
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
  const fileActions: { label: string; sf: SFSymbol; material?: MaterialSymbol; disabled?: boolean; startsGroup?: boolean; onPress: () => void }[] = [
    // The table on screen, back a step and forward again (APP-STATE, "Undo").
    { label: labelOf("undo"), sf: "arrow.uturn.backward", disabled: !derived.canUndo, onPress: () => dispatch({ type: "undo" }) },
    { label: labelOf("redo"), sf: "arrow.uturn.forward", disabled: !derived.canRedo, onPress: () => dispatch({ type: "redo" }) },
    {
      startsGroup: true,
      label: `New Table in ${state.bundles[bundle]?.title ?? bundle}`,
      sf: "tablecells.badge.ellipsis",
      material: "table",
      onPress: () => dispatch({ type: "create", making: { kind: "table", bundle } }),
    },
    { label: labelOf("new-file"), sf: "doc.badge.plus", material: "note_add", onPress: () => dispatch({ type: "create", making: { kind: "file" } }) },
    { label: labelOf("open-zip"), sf: "folder", material: "folder_open", onPress: () => void app.openZip() },
    { label: labelOf("export-zip"), sf: "square.and.arrow.up", material: "share", onPress: () => void app.exportZip() },
    { label: "Files", sf: "folder.badge.gearshape", material: "folder_open", onPress: () => router.push("/files") },
    { label: "Settings", sf: "gearshape", material: "settings", onPress: () => setAppSettings(true) },
  ];

  return (
    <>
      {/* The table first, before the bars' elements below: expo-router
          draws those as native views too, and UIKit collapses the large
          title only for a scroll view that comes first in the screen. */}
      <CellEditorContext.Provider value={GLASS ? glass.editor : null}>
      <PageGutter.Provider value={MOBILE_H_PADDING}>
      <PortalHost>
        <ScrollView
          ref={scroller}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
            page.onScroll(e);
          }}
          scrollEventThrottle={16}
          onLayout={(e) => {
            page.onLayout(e);
            // (The scroll view measures as any view does; its type doesn't say so.)
            (scroller.current as unknown as { measureInWindow?: (done: (x: number, y: number) => void) => void } | null)?.measureInWindow?.(
              (_x, y) => page.setWindowTop(y),
            );
          }}
          onContentSizeChange={page.onContentSizeChange}
          // Where a scroll comes to rest is where you are, for history.
          onScrollEndDrag={(e) => {
            if (e.nativeEvent.velocity?.y === 0) notePlace();
          }}
          onMomentumScrollEnd={notePlace}
          // Tracked by the large title, which collapses as it scrolls.
          contentInsetAdjustmentBehavior="automatic"
          style={{ flex: 1 }}
          // Room under the last row for the glass control on iOS.
          // and, while an editor is open, room for any cell to scroll clear of it.
          contentContainerStyle={{ paddingHorizontal: MOBILE_H_PADDING, paddingBottom: GLASS ? 96 + glass.reserve : 24, flexGrow: 1 }}
          // The keyboard makes room rather than covering the cell being edited,
          // and a tap elsewhere while typing goes to what's tapped. On iOS the
          // glass bar's editor leaves that room itself (`reserve`) and scrolls
          // the cell into view: the automatic insets also scroll the focused
          // field into view, and that field is in the bar, not the table, so
          // they threw the table up behind the navigation bar.
          automaticallyAdjustKeyboardInsets={!GLASS}
          keyboardShouldPersistTaps="handled"
          // iOS: scrolling puts the keyboard away and saves what was typed.
          {...(GLASS ? { keyboardDismissMode: "on-drag" as const, onScrollBeginDrag: glass.onScrollBegin } : {})}
        >
          <PageScrollContext.Provider value={page.pageScroll}>
          {/* iOS: a tap on empty space (around or below the table) closes the editor and deselects. */}
          <Pressable onPress={GLASS ? glass.dismiss : undefined} disabled={!GLASS} style={{ flexGrow: 1 }} accessible={false}>
          <html.span dir="auto" style={styles.place}>{derived.breadcrumb.text}</html.span>
          <html.div style={styles.subtitle}>
            {/* While a large table is read, how far that has got is in the count's place, and nothing is said of its rows yet. */}
            {indexed.building ? (
              <html.span>{readingText(indexed.building)}</html.span>
            ) : (
              // A search of a large table takes a moment: the count waits for its rows.
              <html.span>{indexed.stale && state.search.trim().length > 0 ? "Searching…" : summary.count}</html.span>
            )}
            {indexed.building ? null : <html.span>·</html.span>}
            {indexed.building ? null : summary.valid ? (
              <html.span style={styles.validityOk}>{summary.validity}</html.span>
            ) : (
              // Which rows, and why: the web shows them on hover, which a
              // touch screen has none of, so a tap lists them.
              <html.button
                aria-label={`${summary.validity}: show them`}
                onClick={() =>
                  Alert.alert(
                    summary.validity,
                    summary.errors
                      .slice(0, ERRORS_LISTED)
                      .map((e) => {
                        // A row by its title, or by its place when it has none
                        // (a new row's title is only its id); a field by its title.
                        const title = e.rowId ? rowTitleFor(table, e.rowId) : undefined;
                        const row = title && title !== e.rowId ? title : `Row ${e.rowIndex + 1}`;
                        const field = table.schema.fields.find((f) => f.name === e.field);
                        return `${row} · ${field ? `${field.title ?? field.name}: ` : ""}${e.message}`;
                      })
                      .join("\n") + (summary.errors.length > ERRORS_LISTED ? `\n…and ${summary.errors.length - ERRORS_LISTED} more` : ""),
                  )
                }
                style={styles.validityButton}
              >
                <html.span style={styles.validityBad}>{summary.validity}</html.span>
              </html.button>
            )}
            {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
            {/* What it means, which the web says on hover: a tap says it here. */}
            {summary.schemaChanged && (
              <html.button
                aria-label={`${summary.schemaChangedLabel}: what this means`}
                onClick={() => Alert.alert(summary.schemaChangedLabel, summary.schemaChangedHint)}
                style={styles.validityButton}
              >
                <html.span style={styles.schemaBumpBadge}>{summary.schemaChangedLabel}</html.span>
              </html.button>
            )}
          </html.div>
          {appSettings && <AppSettings onClose={() => setAppSettings(false)} />}
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
          {indexed.lost ? (
            <html.span style={styles.indexedNote}>This table's rows are no longer on this phone. Open its .table.zip again to bring them back.</html.span>
          ) : table.indexed && view.layout !== "table" ? (
            <html.span style={styles.indexedNote}>This layout isn't shown for a table this large yet. Change the view's layout to Table in its settings.</html.span>
          ) : table.indexed && !indexed.source && !reading ? null : (
            // A large table shows its rows at once, as its file has them, and as many as
            // have been read so far, while it is read into its index (LARGE-TABLES-PLAN,
            // decision 1): to scroll through and look at. The view's own order, filters and
            // groups, search and editing come with the index. One table view for both, so
            // where you had scrolled to is where you still are when the reading is done.
            <>
              {reading && <html.span style={styles.indexedNote}>{ingestingText(shownView)}</html.span>}
              {renderView(
                reading ? asStored(shownView) : shownView,
                reading ? NO_ROWS : visibleRows,
                table.schema,
                reading ? undefined : table.bodies,
                reading
                  ? {
                      source: reading,
                      relatedTables: bundleTables(state.tables, bundle),
                      onOpenRelation: () => {},
                      allRows: NO_ROWS,
                      tableKey: tableNameOf(state.active),
                    }
                  : {
                      ...callbacks,
                      relatedTables: bundleTables(state.tables, bundle),
                      allRows: table.rows,
                      tableKey: tableNameOf(state.active),
                      sheet,
                      onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
                      onPlace: (p) => dispatch({ type: "place", place: { rowId: p.rowId, field: p.field } }),
                      restorePlace: state.restoring ? { place: state.restoring.place, n: state.restoring.n } : null,
                      onPlaceMeasure,
                      ...(table.indexed
                        ? {
                            source: indexed.source,
                            // Removing a choice takes it out of every row that holds it, which the index can't yet do in place.
                            onRemoveEnumValue: undefined,
                            onDeleteField: undefined,
                          }
                        : {}),
                    },
              )}
            </>
          )}
          </Pressable>
          </PageScrollContext.Provider>
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
      </CellEditorContext.Provider>
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
            {/* Back to where you were before following a link or changing view: the view, the cell, the page, the search, how far down. */}
            {derived.canGoBack ? (
              <Stack.Toolbar.Button icon="chevron.backward" accessibilityLabel="Back" onPress={() => dispatch({ type: "back" })} />
            ) : null}
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
      {/* Android: search in the top app bar. */}
      {!GLASS && (
        <Stack.SearchBar
          ref={searchBar}
          placeholder="Search"
          onChangeText={(e: { nativeEvent: { text: string } }) => dispatch({ type: "search", text: e.nativeEvent.text })}
          onCancelButtonPress={() => dispatch({ type: "search", text: "" })}
          onClose={() => dispatch({ type: "search", text: "" })}
        />
      )}
      {/* iOS: view settings, search, the selected cell and its editor, and
          the file actions, in one glass control at the foot. */}
      {GLASS && (
        <GlassBar
          ref={glass.bar}
          {...glass.props}
          moreActions={fileActions.map((a) => ({ label: a.label, symbol: a.sf, disabled: a.disabled, startsGroup: a.startsGroup, onPress: a.onPress }))}
        />
      )}
    </>
  );
}

const styles = css.create({
  // What's said in place of a large table's rows, or above them while they're read.
  indexedNote: {
    fontSize: 12,
    opacity: 0.7,
    paddingBlock: 8,
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
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
  validityButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
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
