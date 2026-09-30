// First, before anything makes an id: Hermes has no crypto.getRandomValues,
// which core's newId uses (a new row, view, table or file).
import "react-native-get-random-values";
import { AppRegistry } from "react-native";
import App from "./App";

AppRegistry.registerComponent("TableDesktop", () => App);
