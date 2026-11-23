/**
 * iOS: a month's weeks in a native paging scroll view. Each month has a fixed
 * place along it and only those around the one shown are drawn, so moving on
 * never swaps what's under the finger. A month's height is shown by moving
 * things, on the native thread with the scroll, and never by laying the page
 * out again: the room for the tallest month stays, a clip's edge rises to the
 * month's foot, and what's under the grid rises with it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import type { FollowsMonthProps, MonthPagerProps } from "../controlSlots";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** What the pager asks of its scroll view; the React Native versions it builds against type the ref differently. */
interface Scroller {
  scrollTo(to: { x: number; y: number; animated: boolean }): void;
}

const BACK_EDGE = 16;

export function MonthPager(props: MonthPagerProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  // Until it's measured: the month where it will be, so nothing is blank.
  if (width === 0) {
    return (
      <View onLayout={onLayout} style={{ height: props.tallest }}>
        <View style={{ height: props.heightOf(props.month), overflow: "hidden" }}>{props.renderMonth(props.month)}</View>
      </View>
    );
  }
  // A new width (the phone turned) places every month afresh.
  return <Pages key={`${width}:${props.first}`} {...props} width={width} onLayout={onLayout} />;
}

function Pages({ month, first, last, heightOf, tallest, onShift, renderMonth, onMonth, width, onLayout }: MonthPagerProps & { width: number; onLayout: (e: LayoutChangeEvent) => void }) {
  const scroller = useRef<Scroller | null>(null);
  const placeOf = (m: number) => (m - first) * width;
  const opening = useRef({ x: placeOf(month), y: 0 }).current;
  const scrollX = useRef(new Animated.Value(opening.x)).current;
  // The month nearest the middle while it moves, and the one a button is sliding to.
  const [near, setNear] = useState(month);
  const nearNow = useRef(month);
  const restingOn = useRef(month);
  const slidingTo = useRef<number | null>(null);

  const monthAt = (x: number) => Math.max(first, Math.min(last, first + Math.round(x / width)));
  const follow = (e: ScrollEvent) => {
    const at = monthAt(e.nativeEvent.contentOffset.x);
    if (at !== nearNow.current) {
      nearNow.current = at;
      setNear(at);
    }
  };
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: follow }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollX, first, last, width],
  );
  const settle = (x: number) => {
    const at = monthAt(x);
    if (slidingTo.current !== null) {
      if (at === slidingTo.current) slidingTo.current = null;
      return;
    }
    restingOn.current = at;
    if (at !== month) onMonth(at);
  };
  const endDrag = (e: ScrollEvent) => {
    // Let go without a flick: at rest already, so no deceleration will say so.
    const { x } = e.nativeEvent.contentOffset;
    if (Math.abs(x / width - Math.round(x / width)) < 0.01) settle(x);
  };

  // Previous, Next, Today or the date picker: one month away slides, further is a jump.
  useEffect(() => {
    if (restingOn.current === month) return;
    const by = Math.abs(month - restingOn.current);
    restingOn.current = month;
    nearNow.current = month;
    setNear(month);
    slidingTo.current = by === 1 ? month : null;
    scroller.current?.scrollTo({ x: placeOf(month), y: 0, animated: by === 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const drawn = [...new Set([near - 1, near, near + 1, month])].filter((m) => m >= first && m <= last).sort((a, b) => a - b);
  // Every month's place once, so the native animation is never replaced during a swipe.
  const shift = useMemo(() => {
    if (last === first) return new Animated.Value(heightOf(first) - tallest);
    const months = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    return scrollX.interpolate({ inputRange: months.map(placeOf), outputRange: months.map((m) => heightOf(m) - tallest), extrapolate: "clamp" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollX, first, last, width, tallest]);
  const unshift = useMemo(() => Animated.multiply(shift, -1), [shift]);
  useEffect(() => {
    onShift?.(shift);
    return () => onShift?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);

  return (
    <View onLayout={onLayout} style={{ height: tallest }}>
      <Animated.View style={{ height: tallest, overflow: "hidden", transform: [{ translateY: shift }] }}>
      <Animated.View style={{ height: tallest, transform: [{ translateY: unshift }] }}>
      <Animated.ScrollView
        ref={(view: unknown) => {
          scroller.current = view as Scroller | null;
        }}
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        scrollsToTop={false}
        scrollEventThrottle={16}
        contentOffset={opening}
        onScroll={onScroll}
        onScrollEndDrag={endDrag}
        onMomentumScrollEnd={(e: ScrollEvent) => settle(e.nativeEvent.contentOffset.x)}
      >
        <View style={{ width: (last - first + 1) * width, height: tallest }}>
          {drawn.map((m) => (
            <View key={m} style={{ position: "absolute", top: 0, left: placeOf(m), width }}>
              {renderMonth(m)}
            </View>
          ))}
        </View>
      </Animated.ScrollView>
      {/* The screen's left edge stays the system's Back gesture: a touch here never reaches the pager. */}
      <View collapsable={false} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: BACK_EDGE }} />
      </Animated.View>
      </Animated.View>
    </View>
  );
}

/** What's under the grid, moved with the swipe. */
export function FollowsMonth({ shift, children }: FollowsMonthProps) {
  return <Animated.View style={{ transform: [{ translateY: shift as Animated.Value }] }}>{children}</Animated.View>;
}
