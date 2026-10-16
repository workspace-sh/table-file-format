/**
 * Native default — Metro resolves to this. Vite picks `.web.tsx`.
 *
 * Horizontal scroll that snaps to fixed-width "snap points". Used by
 * BoardView on phones to deliver the Trello-style column carousel:
 * one column dominates the viewport, the next peeks at the right
 * edge, swipe horizontally to advance one column at a time.
 *
 * RN's ScrollView has first-class snap support via `snapToInterval`
 * (interval-based) or `snapToOffsets` (point-based). We use the
 * interval form — columns are uniform width.
 */
import { useContext, useState, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { PageGutter } from "../pageGutter";

export interface SnapHScrollProps {
  children?: ReactNode;
  /** Width of one snap step in points (column width + gap). */
  snapInterval: number;
  /** Optional left padding inside the scroll content. */
  paddingLeft?: number;
  /** Space between the children, in points. */
  gap?: number;
}

export function SnapHScroll({
  children,
  snapInterval,
  paddingLeft,
  gap,
}: SnapHScrollProps) {
  // Bled over the page's margins (Bleed): the first column rests on the
  // margin, and each snap lines one up there.
  const gutter = useContext(PageGutter);
  // The last column rests there too, with room after it: ended at the
  // margin instead, the scroll ran out before the last snap, so the last
  // column stopped short with the one before it showing, out of line with
  // every other (and by more on a turned phone, where more columns show).
  const [width, setWidth] = useState(0);
  const column = snapInterval - (gap ?? 0);
  const trailing = width > 0 ? Math.max(gutter, width - gutter - column) : gutter;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={snapInterval}
      snapToAlignment="start"
      decelerationRate="fast"
      // One column a swipe, however fast: a flick carried it two or three.
      disableIntervalMomentum
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth((prev) => (prev === w ? prev : w));
      }}
      contentContainerStyle={{
        paddingLeft: (paddingLeft ?? 0) + gutter,
        paddingRight: trailing,
        ...(gap ? { gap } : {}),
      }}
    >
      {children}
    </ScrollView>
  );
}
