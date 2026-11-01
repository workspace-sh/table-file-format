/**
 * Native default — Metro resolves to this. Vite picks `HScroll.web.tsx`.
 *
 * Horizontal scroll container. RN's `ScrollView` accepts `horizontal`
 * directly; web uses an html.div with `overflowX: auto` (RSD rejects
 * `overflowX` on native, hence the split).
 *
 * Used by TableView for the "frozen primary column + horizontally
 * scrollable rest" pattern.
 */
import { useEffect, useRef, type ReactNode, type ComponentRef } from "react";
import { Platform, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from "react-native";
import { nearest } from "./nearest";

export interface HScrollProps {
  children?: ReactNode;
  /**
   * Spread to the underlying ScrollView. Lets the consumer pass
   * ref / contentContainerStyle without bloating this wrapper's API.
   */
  scrollProps?: Omit<ScrollViewProps, "horizontal" | "children">;
  /**
   * Where the scroll comes to rest, as offsets from its start (a table's
   * column starts): a scroll the user ends settles on the nearest, so
   * nothing is left cut in half at the edge. The end is always one.
   */
  snapTo?: readonly number[];
}

/** How long a Mac's scroll must have been still before it's settled on a column, in milliseconds. */
const SETTLE_AFTER_MS = 160;

export function HScroll({ children, scrollProps, snapTo }: HScrollProps) {
  const inner = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );
  // iOS and Android bring a scroll to rest on these themselves, as its
  // momentum ends. A Mac's scroll view has no such thing (React Native
  // macOS sets the offsets and never uses them), so there the scroll is
  // moved to the nearest once it has been still for a moment: after the
  // gesture and its momentum, never against them.
  const settles = Platform.OS === "macos" && snapTo !== undefined && snapTo.length > 0;
  const given = scrollProps as (ScrollViewProps & { ref?: unknown }) | undefined;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    given?.onScroll?.(e);
    if (!settles) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const x = contentOffset.x;
    const end = Math.max(0, contentSize.width - layoutMeasurement.width);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const to = nearest(snapTo!, x, end);
      if (Math.abs(to - x) > 0.5) inner.current?.scrollTo({ x: to, animated: true });
    }, SETTLE_AFTER_MS);
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      {...(snapTo && snapTo.length > 0 && !settles ? { snapToOffsets: snapTo as number[], snapToEnd: true } : {})}
      {...scrollProps}
      {...(settles ? { onScroll, scrollEventThrottle: 16 } : {})}
      ref={(view) => {
        inner.current = view;
        const ref = given?.ref as { current: unknown } | ((view: unknown) => void) | undefined;
        if (typeof ref === "function") ref(view);
        else if (ref) ref.current = view;
      }}
    >
      {children}
    </ScrollView>
  );
}
