/**
 * Default (the web, iOS, Android): nothing to add. A browser gives the
 * table's own element the keyboard when a cell in it is clicked and sends
 * it the keys; a touch screen has none. macOS has `GridKeys.macos.tsx`.
 */
import { forwardRef } from "react";
import type { GridKeysHandle, GridKeysProps } from "./GridKeys.types";
export type { GridKeysHandle, GridKeysProps } from "./GridKeys.types";

export const GridKeys = forwardRef<GridKeysHandle, GridKeysProps>(function GridKeys({ children }, _ref) {
  return <>{children}</>;
});
