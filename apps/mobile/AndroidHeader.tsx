// Android's top app bar actions are in AndroidHeader.android.tsx (Compose,
// from @expo/ui); elsewhere the table screen uses its own toolbars, so
// there's nothing to draw.

import type { AndroidHeaderActionsProps } from "./AndroidHeader.types";

export type { MaterialSymbol } from "./AndroidHeader.types";

export function AndroidTablesButton(_props: { onPress: () => void }): null {
  return null;
}

export function AndroidHeaderActions(_props: AndroidHeaderActionsProps): null {
  return null;
}
