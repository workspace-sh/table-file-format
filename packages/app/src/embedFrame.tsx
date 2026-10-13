// The embed's frame and dialog on React Native (iOS, Android, macOS): a
// scroll view of its own, which is the page its rows are drawn and
// recycled in (PageScrollContext), as tall as what it holds up to the
// limit; and the platform's alert for a question. See embedView.shared.tsx.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, ScrollView } from "react-native";
import { PageScrollContext, pageScrollOver } from "@workspace.sh/table-ui";

import type { Confirm } from "./confirm.ts";
import { EMBED_MAX_HEIGHT, TableEmbedWith, type TableEmbedProps } from "./embedView.shared.tsx";

export { EMBED_MAX_HEIGHT, type TableEmbedProps };

function Frame({ limit, children }: { limit: number; children: ReactNode }) {
  const scroller = useRef<ScrollView>(null);
  const page = useMemo(() => pageScrollOver(scroller), []);
  // What it holds, measured: the frame is that tall, up to the limit.
  const [held, setHeld] = useState(0);
  return (
    <ScrollView
      ref={scroller}
      style={{ height: Math.min(held || limit, limit) }}
      nestedScrollEnabled
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
      }}
    >
      <PageScrollContext.Provider value={page.pageScroll}>{children}</PageScrollContext.Provider>
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
