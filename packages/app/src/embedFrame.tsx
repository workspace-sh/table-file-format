// The embed's frame and dialog on React Native (iOS, Android, macOS): a
// scroll view of its own, which is the page its rows are drawn and
// recycled in (PageScrollContext), as tall as what it holds up to the
// limit; and the platform's alert for a question. See embedView.shared.tsx.
// The frame runs over the host page's side margins to the screen's edges
// (PageGutter, as table-ui's Bleed does), so a view that scrolls sideways
// inside it isn't cut off at the margin; what it holds starts and ends in
// line with the page. A host that gives no PageGutter gets no bleed.
// It holds still while something in it is dragged, and has the host's page
// hold still too (PageScroll.lock), and fades in once it has its size.

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Animated, Platform, ScrollView } from "react-native";
import { PageGutter, PageScrollContext, pageScrollOver } from "@workspace.sh/table-ui";

import type { Confirm } from "./confirm.ts";
import { EMBED_MAX_HEIGHT, TableEmbedWith, type TableEmbedProps } from "./embedView.shared.tsx";

export { EMBED_MAX_HEIGHT, type TableEmbedProps };

/** How long what the frame holds keeps the same size before it's shown: its columns are measured after it first lays out. */
const SETTLE_MS = 120;

// React Native for macOS doesn't run an opacity animation on the native
// driver: the view stays at 0, and the table is never seen. There the fade
// runs in JS, once per embed, which costs nothing that matters.
const NATIVE_FADE = Platform.OS !== "macos";

function Frame({ limit, children }: { limit: number; children: ReactNode }) {
  const scroller = useRef<ScrollView>(null);
  // The host's page, if it has one: held still too while something in the
  // table is dragged, or the document would scroll under the finger.
  const outer = useContext(PageScrollContext);
  const outerRef = useRef(outer);
  outerRef.current = outer;
  const [locked, setLocked] = useState(false);
  const page = useMemo(
    () =>
      pageScrollOver(scroller, {
        lock: (on) => {
          setLocked(on);
          outerRef.current?.lock?.(on);
        },
      }),
    [],
  );
  // What it holds, measured: the frame is that tall, up to the limit.
  const [held, setHeld] = useState(0);
  // Shown once what it holds has stopped changing size (its columns are
  // measured after the first layout, which changes its height again): until
  // then the frame keeps one height and draws nothing, so the document
  // around it moves once, not at every step, and the table fades in.
  const [settled, setSettled] = useState(false);
  const shown = useRef(new Animated.Value(0)).current;
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (settling.current && clearTimeout(settling.current)), []);
  const gutter = useContext(PageGutter);
  const height = settled ? Math.min(held || limit, limit) : limit;
  return (
    <ScrollView
      ref={scroller}
      style={{ height, marginHorizontal: -gutter }}
      contentContainerStyle={{ paddingHorizontal: gutter }}
      nestedScrollEnabled
      // It scrolls only when it holds more than it shows; held still while
      // something in it is dragged. A frame that bounced when everything
      // fitted took the swipes meant for the document.
      scrollEnabled={!locked}
      alwaysBounceVertical={false}
      bounces={held > limit}
      scrollEventThrottle={16}
      onScroll={page.onScroll}
      onLayout={(e) => {
        page.onLayout(e);
        // Where it is in the window, for what's drawn over a cell (an editor, a menu).
        (scroller.current as unknown as { measureInWindow?: (done: (x: number, y: number) => void) => void } | null)?.measureInWindow?.((_x, y) => page.setWindowTop(y));
      }}
      onContentSizeChange={(_w, h) => {
        page.onContentSizeChange();
        setHeld(h);
        if (settled) return;
        if (settling.current) clearTimeout(settling.current);
        settling.current = setTimeout(() => {
          setSettled(true);
          Animated.timing(shown, { toValue: 1, duration: 180, useNativeDriver: NATIVE_FADE }).start();
        }, SETTLE_MS);
      }}
    >
      <PageScrollContext.Provider value={page.pageScroll}>
        <Animated.View style={{ opacity: shown }}>{children}</Animated.View>
      </PageScrollContext.Provider>
    </ScrollView>
  );
}

function ask(confirm: Confirm, answer: (response: string) => void) {
  Alert.alert(
    confirm.heading,
    confirm.body || undefined,
    confirm.responses.map((r) => ({
      text: r.label,
      style: r.id === "cancel" ? ("cancel" as const) : r.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => answer(r.id),
    })),
  );
}

export function TableEmbed(props: TableEmbedProps) {
  return TableEmbedWith(props, Frame, ask);
}
