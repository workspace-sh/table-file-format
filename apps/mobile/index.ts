// First, before anything makes an id: Hermes has no crypto.getRandomValues,
// which core's newId uses (a new row, view, table or file).
import "react-native-get-random-values";
// Before anything formats a date: see intl.ts.
import "./intl";
// Then the app: expo-router's entry, which loads app/.
import "expo-router/entry";
