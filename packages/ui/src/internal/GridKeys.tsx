/**
 * Default (the web, iOS, Android): nothing to add. A browser gives the
 * table's own element the keyboard when a cell in it is clicked and sends
 * it the keys; a touch screen has none. macOS has `GridKeys.macos.tsx`.
 */
import { forwardRef, type ReactNode } from "react";

export interface GridKeysHandle {
  /** Take the keyboard. */
  focus: () => void;
}

export interface GridKeysProps {
  onKeyDown: (e: {
    key: string;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    preventDefault?: () => void;
  }) => void;
  children: ReactNode;
  /** Grow to the width of the row it's in (a table filling the page), where it's a view of its own. */
  grow?: boolean;
}

export const GridKeys = forwardRef<GridKeysHandle, GridKeysProps>(function GridKeys({ children }, _ref) {
  return <>{children}</>;
});
