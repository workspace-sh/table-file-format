/**
 * A failed formula's mark (#685) on the Mac: its kind's SF Symbol, in the
 * error's red, drawn by the TableSymbol view of @workspace.sh/table-mac-controls
 * (an app drawing the library's views on the Mac links its pod). Without that
 * view, the character standing for its kind, as elsewhere (ErrorMark.tsx).
 */
import { UIManager, requireNativeComponent, type ViewProps } from "react-native";
import { ERROR_MARKS, type FormulaErrorGroup } from "../display";
import { ErrorMark as CharacterMark } from "./ErrorMark.tsx";

const hasSymbols = UIManager.hasViewManagerConfig?.("TableSymbol") ?? false;
const TableSymbol = hasSymbols ? requireNativeComponent<ViewProps & { name: string; pointSize: number; tint: string }>("TableSymbol") : null;

export function ErrorMark({ group }: { group: FormulaErrorGroup }) {
  if (!TableSymbol) return <CharacterMark group={group} />;
  return <TableSymbol name={ERROR_MARKS[group].sf} pointSize={11} tint="systemRed" style={{ width: 14, height: 14, marginEnd: 4 }} accessibilityLabel={ERROR_MARKS[group].label} />;
}
