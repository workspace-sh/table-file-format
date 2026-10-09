// First, before anything makes an id: Hermes has no crypto.getRandomValues,
// which core's newId uses (a new row, view, table or file).
import "react-native-get-random-values";
// Before anything formats a date or a currency name: see intl.ts.
import "./intl";
// Before App, whose styles are made as it's imported: see quietWarnings.js.
import "./quietWarnings";
import { AppRegistry } from "react-native";
import App from "./App";
import { Inspector } from "./Inspector";

AppRegistry.registerComponent("TableDesktop", () => App);
// The inspector pane's own React view (TableShell.swift).
AppRegistry.registerComponent("TableInspector", () => Inspector);
