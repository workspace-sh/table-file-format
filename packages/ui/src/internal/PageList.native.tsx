/**
 * Native: a table's rows as the screen's own scrolling list, LegendList
 * (#490; the 2 Oct 2026 decision, LARGE-TABLES.md). LegendList windows only
 * what it scrolls itself, so here it is the screen's scroll view: the page
 * above the table is its header, the new-row band and totals its footer,
 * and each item a whole row. Every height is given up front
 * (getFixedItemSize), so nothing is measured.
 *
 * Sideways, the table's header, rows and footer move together by one
 * offset (translateX), from a horizontal pan over the list, with the
 * native driver's momentum once it's let go. What's above the table stays.
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { Animated, View, useWindowDimensions } from "react-native";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { PageListProps } from "./PageList";

export type { PageListHandle, PageListProps } from "./PageList";

export function PageList({
  count,
  keyOf,
  sizeOf,
  renderRow,
  header,
  tableHeader,
  footer,
  contentWidth,
  snapTo,
  extraData,
  onShown,
  handle,
  scrollProps,
  onScroller,
}: PageListProps): ReactNode {
  const list = useRef<LegendListRef | null>(null);
  const { width } = useWindowDimensions();
  const maxX = Math.max(0, contentWidth - width);
  const limit = useRef(maxX);
  limit.current = maxX;

  // How far the table is scrolled sideways, with UIScrollView's feel: past
  // either end a drag gives on its rubber-band curve, and a flick carries on
  // at its speed to a column's start (snapTo, as the edge-to-edge table's
  // scroll view snaps) or the end, or springs back from past an end.
  const scrollX = useRef(new Animated.Value(0)).current;
  const x = useRef(0);
  useEffect(() => {
    const id = scrollX.addListener(({ value }) => void (x.current = value));
    return () => scrollX.removeListener(id);
  }, [scrollX]);
  const snaps = useRef(snapTo);
  snaps.current = snapTo;
  const screen = useRef(width);
  screen.current = width;
  // A narrower table (a column removed, the phone turned) is brought back in range.
  useEffect(() => {
    if (x.current > maxX) scrollX.setValue(maxX);
  }, [maxX, scrollX]);
  const shift = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);

  const pan = useMemo(() => {
    const from = { x: 0 };
    // UIScrollView's rubber band: `over` points past an end shows as this much.
    const band = (over: number) => (1 - 1 / ((over * 0.55) / screen.current + 1)) * screen.current;
    return (
      Gesture.Pan()
        .runOnJS(true)
        // Sideways only: a mostly vertical drag is the list's own scroll.
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          scrollX.stopAnimation();
          from.x = x.current;
        })
        .onUpdate((e) => {
          const wanted = from.x - e.translationX;
          const max = limit.current;
          scrollX.setValue(wanted < 0 ? -band(-wanted) : wanted > max ? max + band(wanted - max) : wanted);
        })
        .onEnd((e) => {
          const max = limit.current;
          const v = -e.velocityX; // points a second, as the spring takes it
          let to: number;
          if (x.current < 0) to = 0;
          else if (x.current > max) to = max;
          else {
            // Where the flick would come to rest at UIScrollView's normal
            // deceleration (0.998 a millisecond), and the column start
            // nearest that, or the end.
            const rest = Math.min(max, Math.max(0, x.current + (v / 1000) * (0.998 / (1 - 0.998))));
            const stops = [...(snaps.current ?? []).filter((at) => at < max), max];
            to = stops.reduce((best, at) => (Math.abs(at - rest) < Math.abs(best - rest) ? at : best), stops[0]!);
          }
          Animated.spring(scrollX, { toValue: to, velocity: v, useNativeDriver: true, stiffness: 120, damping: 22, mass: 1 }).start();
        })
    );
  }, [scrollX]);

  const sideways = { transform: [{ translateX: shift }], width: contentWidth };

  // Where the first row is in the window: the scroll view's top, plus the
  // header above the rows, less how far it's scrolled.
  const at = useRef({ windowTop: 0, header: 0, offset: 0 });
  const box = useRef<View | null>(null);
  const appScroll = scrollProps.onScroll as ((e: { nativeEvent: { contentOffset: { y: number } } }) => void) | undefined;

  useImperativeHandle(
    handle,
    () => ({
      scrollIndexIntoView: (index: number) => {
        void list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      },
      top: () => at.current.windowTop + at.current.header - at.current.offset,
    }),
    [],
  );

  const places = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  const shown = useRef(onShown);
  shown.current = onShown;
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { index: number }[] }) => {
    if (viewableItems.length === 0) return;
    let first = Infinity;
    let last = -1;
    for (const v of viewableItems) {
      first = Math.min(first, v.index);
      last = Math.max(last, v.index);
    }
    shown.current?.(first, last);
  }, []);

  return (
    <GestureDetector gesture={pan}>
      <View
        ref={box}
        collapsable={false}
        style={{ flex: 1 }}
        onLayout={() => box.current?.measureInWindow((_x, y) => void (at.current.windowTop = y))}
      >
        <LegendList
          ref={(ref: LegendListRef | null) => {
            list.current = ref;
            if (ref) onScroller?.(ref.getNativeScrollRef());
          }}
          data={places}
          keyExtractor={(place: number) => keyOf(place)}
          getFixedItemSize={(place: number) => sizeOf(place)}
          estimatedItemSize={count > 0 ? sizeOf(0) : 46}
          renderItem={({ item }: { item: number }) => <Animated.View style={sideways}>{renderRow(item)}</Animated.View>}
          // A row's views are kept as it scrolls off and given the next row
          // to show, not made again (its cells start again: EditableCell's rowKey).
          recycleItems
          ListHeaderComponent={
            <View onLayout={(e) => void (at.current.header = e.nativeEvent.layout.height)}>
              {header}
              <Animated.View style={sideways}>{tableHeader}</Animated.View>
            </View>
          }
          ListFooterComponent={<Animated.View style={sideways}>{footer}</Animated.View>}
          extraData={extraData}
          onViewableItemsChanged={onViewable}
          style={{ flex: 1 }}
          {...scrollProps}
          onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => {
            at.current.offset = e.nativeEvent.contentOffset.y;
            appScroll?.(e);
          }}
        />
      </View>
    </GestureDetector>
  );
}
