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
import type { ReactNode } from "react";
import { ScrollView } from "react-native";

export interface SnapHScrollProps {
  children?: ReactNode;
  /** Width of one snap step in points (column width + gap). */
  snapInterval: number;
  /** Optional left padding inside the scroll content. */
  paddingLeft?: number;
}

export function SnapHScroll({
  children,
  snapInterval,
  paddingLeft,
}: SnapHScrollProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={snapInterval}
      snapToAlignment="start"
      decelerationRate="fast"
      contentContainerStyle={paddingLeft ? { paddingLeft } : undefined}
    >
      {children}
    </ScrollView>
  );
}
