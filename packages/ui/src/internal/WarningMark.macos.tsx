/** That a file doesn't meet its schema: the system's warning symbol, as ErrorMark draws its own. */
import { TableSymbol } from "./ErrorMark.macos";
import { WarningMark as CharacterMark } from "./WarningMark.tsx";

export function WarningMark() {
  if (!TableSymbol) return <CharacterMark />;
  return <TableSymbol name="exclamationmark.triangle.fill" pointSize={12} tint="systemOrange" style={{ width: 16, height: 16 }} />;
}
