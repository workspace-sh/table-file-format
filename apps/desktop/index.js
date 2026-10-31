// First, before anything makes an id: Hermes has no crypto.getRandomValues,
// which core's newId uses (a new row, view, table or file).
import "react-native-get-random-values";
// Hermes here has no TextDecoder, which reading a large table's rows uses
// (table-app's indexed.ts): the polyfill sets it, and TextEncoder, only
// where they're missing.
import "fast-text-encoding";
// Before anything formats a date or a currency name: see intl.ts.
import "@workspace.sh/table-app/intl";
// Before any table is read: formulas by the EDN core, where this build has it.
import "@workspace.sh/table-app/formula-engine";
// Before App, whose styles are made as it's imported: see quietWarnings.js.
import "./quietWarnings";
import { AppRegistry } from "react-native";
import App from "./App";
import { Inspector } from "./Inspector";

AppRegistry.registerComponent("TableDesktop", () => App);
// The inspector pane's own React view (TableShell.swift).
AppRegistry.registerComponent("TableInspector", () => Inspector);
