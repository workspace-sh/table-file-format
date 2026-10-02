// Measuring list libraries for large tables (#126): the same table-shaped
// row drawn by FlashList v2 or LegendList, N rows, inside a sideways
// scroller as the table will be. Only in a measuring build
// (EXPO_PUBLIC_TABLE_MEASURE=1) or development: measure.ts opens it with
// ?lib=flash|legend&n=<rows>, and it scripts a scroll and posts the times.
//
// Rows are made from their index (no parsing): the data side is measured
// apart (scripts/big-table-read.mts). Each row has what a table row costs:
// eight cells, a coloured choice, money formatted for the locale, and the
// platform's row menu (RowActions, the system context menu on iOS).

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PlatformColor, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { usePlatformControls } from "@workspace.sh/table-ui";
import { MEASURING, report } from "../measure";

const ROW_HEIGHT = 44;
const CELL = 140;
const FIELDS = ["title", "stage", "amount", "probability", "owner", "close_date", "note", "weighted"];
const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const PILL: Record<string, string> = { lead: "#e8e8ed", qualified: "#dde9fd", proposal: "#ece3fd", negotiation: "#fde8d4", won: "#dcf5e3", lost: "#fde2e1" };
const money = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const WORDS = ["Atlas", "Northwind", "Lumen", "Tidal", "Quill", "Fern", "Harbor", "Summit"];
const KINDS = ["renewal", "expansion", "pilot", "migration", "audit", "rollout"];

/** The deepest row index drawn so far: how far the list has caught up. */
let deepest = -1;

const Row = memo(function Row({ i }: { i: number }) {
  const { RowActions } = usePlatformControls();
  if (i > deepest) deepest = i;
  const stage = STAGES[i % STAGES.length]!;
  const amount = ((i * 7919) % 200) * 500;
  const probability = ((i * 31) % 100) / 100;
  const cells = [
    `${WORDS[i % WORDS.length]} ${KINDS[i % KINDS.length]} ${i + 1}`,
    stage,
    money.format(amount),
    probability.toFixed(2),
    ["leslie", "sam", "maya", "jonas"][i % 4]!,
    `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    i % 3 === 0 ? "Follow up next week." : "",
    money.format(Math.round(amount * probability)),
  ];
  return (
    <RowActions actions={[{ id: "delete", label: "Delete Row", destructive: true, onSelect: () => {} }]}>
      <View style={{ flexDirection: "row", height: ROW_HEIGHT, borderBottomWidth: 1, borderColor: PlatformColor("separator") }}>
        {cells.map((text, c) => (
          <View key={FIELDS[c]} style={{ width: CELL, paddingHorizontal: 16, justifyContent: "center" }}>
            {c === 1 ? (
              <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: PILL[text] }}>
                <Text style={{ fontSize: 11 }}>{text}</Text>
              </View>
            ) : (
              <Text numberOfLines={1} style={{ fontSize: 15, color: PlatformColor("label") }}>
                {text}
              </Text>
            )}
          </View>
        ))}
      </View>
    </RowActions>
  );
});

const frame = () => new Promise<number>((done) => requestAnimationFrame((t) => done(t)));

export default function Bench() {
  const params = useLocalSearchParams<{ lib?: string; n?: string }>();
  const lib = params.lib === "legend" ? "legend" : "flash";
  const n = Number(params.n ?? 10000);
  const data = useMemo(() => Array.from({ length: n }, (_, i) => i), [n]);
  const flash = useRef<FlashListRef<number>>(null);
  const legend = useRef<LegendListRef>(null);
  const [started] = useState(() => performance.now());
  const ran = useRef(false);

  // Where the list is scrolled to, from its own scroll events.
  const scrollY = useRef(0);
  const scrolled = useRef<() => void>(() => {});
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    scrolled.current();
  };

  useEffect(() => {
    if (ran.current || !(MEASURING || __DEV__)) return;
    ran.current = true;
    void (async () => {
      // Mounted: the first rows are on screen.
      await frame();
      await frame();
      await report({ step: "bench-mounted", lib, n, mount: Math.round(performance.now() - started) });
      // Real flicks (the Simulator's touches): from the first scroll event,
      // three seconds of frames, counting the ones where the rows drawn
      // hadn't reached the bottom of the screen (a blank strip).
      await new Promise<void>((go) => (scrolled.current = go));
      scrolled.current = () => {};
      const screenRows = Math.ceil(800 / ROW_HEIGHT);
      let frames = 0;
      let blank = 0;
      let longest = 0;
      const t0 = performance.now();
      let last = t0;
      deepest = -1;
      while (performance.now() - t0 < 3000) {
        const t = await frame();
        longest = Math.max(longest, t - last);
        last = t;
        frames++;
        const bottomRow = Math.floor(scrollY.current / ROW_HEIGHT) + screenRows;
        if (deepest >= 0 && deepest < Math.min(bottomRow, n - 1)) blank++;
      }
      const flingMs = performance.now() - t0;
      // Jump to the last row and wait until it's drawn.
      const t1 = performance.now();
      if (lib === "flash") flash.current?.scrollToEnd({ animated: false });
      else legend.current?.scrollToEnd({ animated: false });
      let waited = 0;
      while (deepest < n - 15 && waited < 600) {
        await frame();
        waited++;
      }
      await report({
        step: "bench",
        lib,
        n,
        fps: Math.round((frames * 1000) / flingMs),
        longestFrame: Math.round(longest),
        blankFrames: blank,
        frames,
        jumpToEnd: deepest >= n - 15 ? Math.round(performance.now() - t1) : -1,
      });
    })();
  }, [lib, n, started]);

  return (
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: CELL * FIELDS.length }}>
      <View style={{ width: CELL * FIELDS.length, flex: 1 }}>
        <Text style={{ padding: 16, fontSize: 13, color: PlatformColor("secondaryLabel") }}>
          {lib === "flash" ? "FlashList 2" : "LegendList 3"} · {n.toLocaleString("en")} rows
        </Text>
        {lib === "flash" ? (
          <FlashList ref={flash} data={data} onScroll={onScroll} renderItem={({ item }) => <Row i={item} />} keyExtractor={(i) => String(i)} />
        ) : (
          <LegendList
            ref={legend}
            data={data}
            onScroll={onScroll}
            renderItem={({ item }: { item: number }) => <Row i={item} />}
            keyExtractor={(i: number) => String(i)}
            estimatedItemSize={ROW_HEIGHT}
            // Every row is the same height: no measuring.
            getFixedItemSize={() => ROW_HEIGHT}
            recycleItems
          />
        )}
      </View>
    </ScrollView>
  );
}
