// What every GridKeys variant takes and offers, in a file of its own: with
// platform suffixes resolved, "./GridKeys" from a variant can mean the variant itself.
import type { ReactNode } from "react";

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
  /** The widest it grows: the table's columns at their natural widths. */
  most?: number;
}
