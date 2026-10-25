/** A failed formula's mark (#685) on iOS: its kind's SF Symbol, in the error's red. */
import { PlatformColor } from "react-native";
import { SymbolView } from "expo-symbols";
import { ERROR_MARKS, type FormulaErrorGroup } from "../display";

export function ErrorMark({ group }: { group: FormulaErrorGroup }) {
  return <SymbolView name={ERROR_MARKS[group].sf as never} size={13} tintColor={PlatformColor("systemRed")} style={{ marginEnd: 4 }} />;
}
