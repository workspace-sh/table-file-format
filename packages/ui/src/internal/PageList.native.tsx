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

  // How far the table is scrolled sideways. Past either end it gives, as a
  // scroll view does (a drag goes a third as far), and springs back.
  const scrollX = useRef(new Animated.Value(0)).current;
  const x = useRef(0);
  const springing = useRef(false);
  const springBack = useCallback(() => {
    const to = Math.min(limit.current, Math.max(0, x.current));
    springing.current = true;
    Animated.spring(scrollX, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 16 }).start(() => {
      springing.current = false;
    });
  }, [scrollX]);
  const decaying = useRef(false);
  useEffect(() => {
    const id = scrollX.addListener(({ value }) => {
      x.current = value;
      // Momentum that runs past an end stops there and springs back.
      if (decaying.current && (value < 0 || value > limit.current)) {
        decaying.current = false;
        scrollX.stopAnimation();
        springBack();
      }
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, springBack]);
  // A narrower table (a column removed, the phone turned) is brought back in range.
  useEffect(() => {
    if (x.current > maxX) scrollX.setValue(maxX);
  }, [maxX, scrollX]);
  const shift = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);

  const pan = useMemo(() => {
    const from = { x: 0 };
    return (
      Gesture.Pan()
        .runOnJS(true)
        // Sideways only: a mostly vertical drag is the list's own scroll.
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          decaying.current = false;
          scrollX.stopAnimation();
          from.x = x.current;
        })
        .onUpdate((e) => {
          const wanted = from.x - e.translationX;
          const max = limit.current;
          // Past an end, a third as far.
          const given = wanted < 0 ? wanted / 3 : wanted > max ? max + (wanted - max) / 3 : wanted;
          scrollX.setValue(given);
        })
        .onEnd((e) => {
          if (x.current < 0 || x.current > limit.current) {
            springBack();
            return;
          }
          decaying.current = true;
          Animated.decay(scrollX, { velocity: -e.velocityX / 1000, deceleration: 0.997, useNativeDriver: true }).start(() => {
            decaying.current = false;
          });
        })
    );
  }, [scrollX, springBack]);

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
