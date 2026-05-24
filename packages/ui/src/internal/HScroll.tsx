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
import type { ReactNode } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

export interface HScrollProps {
  children?: ReactNode;
  /**
   * Spread to the underlying ScrollView. Lets the consumer pass
   * ref / contentContainerStyle without bloating this wrapper's API.
   */
  scrollProps?: Omit<ScrollViewProps, "horizontal" | "children">;
}

export function HScroll({ children, scrollProps }: HScrollProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      {...scrollProps}
    >
      {children}
    </ScrollView>
  );
}
