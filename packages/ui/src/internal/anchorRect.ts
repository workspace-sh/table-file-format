/**
 * Where an anchor is on screen, viewport-relative: what popover positioning
 * needs. In a file of its own, free of any renderer, so `shared` (which
 * table-gtk reads) can name it without reaching react-native.
 */
export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}
