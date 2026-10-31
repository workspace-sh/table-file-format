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
import { useContext, useEffect, useRef, useState, type ReactNode, type RefObject, type ComponentRef } from "react";
import { Platform, ScrollView } from "react-native";
import { PageGutter } from "../pageGutter";

export interface SnapHScrollProps {
  children?: ReactNode;
  /** Width of one snap step in points (column width + gap). */
  snapInterval: number;
  /** Optional left padding inside the scroll content. */
  paddingLeft?: number;
  /** Space between the children, in points. */
  gap?: number;
  /** Filled with a way to page the scroll a snap step at a time: a card dragged to an edge pages the board toward it. */
  pager?: RefObject<CarouselPager | null>;
}

/** Pages a carousel one snap step back (-1) or forward (1), animated, and stops at its ends. */
export interface CarouselPager {
  page(direction: -1 | 1): void;
}

/** How long a Mac's scroll must have been still before it's settled on a column, in milliseconds (as HScroll's). */
const SETTLE_AFTER_MS = 160;

export function SnapHScroll({
  children,
  snapInterval,
  paddingLeft,
  gap,
  pager,
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
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const contentWidth = useRef(0);
  // A Mac's scroll view has no snapping (React Native macOS takes
  // snapToInterval and never uses it): there the scroll is moved to the
  // nearest column once it has been still a moment, as HScroll does.
  const settles = Platform.OS === "macos";
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );
  useEffect(() => {
    if (!pager) return;
    pager.current = {
      page: (direction) => {
        const max = Math.max(0, contentWidth.current - width);
        const step = Math.round(offset.current / snapInterval) + direction;
        const x = Math.min(max, Math.max(0, step * snapInterval));
        if (x !== offset.current) scroller.current?.scrollTo({ x, animated: true });
      },
    };
    return () => {
      pager.current = null;
    };
  }, [pager, snapInterval, width]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      scrollEventThrottle={16}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        offset.current = contentOffset.x;
        if (!settles) return;
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          const x = offset.current;
          const max = Math.max(0, contentSize.width - layoutMeasurement.width);
          const to = Math.min(max, Math.max(0, Math.round(x / snapInterval) * snapInterval));
          if (Math.abs(to - x) > 0.5) scroller.current?.scrollTo({ x: to, animated: true });
        }, SETTLE_AFTER_MS);
      }}
      onContentSizeChange={(w) => {
        contentWidth.current = w;
      }}
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
