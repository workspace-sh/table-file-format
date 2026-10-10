// The SQLite probe (sqliteProbe.ts): what the phone's SQLite can do for the
// index, run on the device. Only in a measuring build
// (EXPO_PUBLIC_TABLE_MEASURE=1) or development, opened by a link:
//
//   sh.workspace.table.mobile://sqlite?rows=100000&modes=async,sync&cases=1
//
// Each step is shown, posted to the measuring server (Simulator) and kept
// in the app's documents as sqlite-probe.json (a device:
// `xcrun devicectl device copy from --domain-type appDataContainer`).

import { useEffect, useRef, useState } from "react";
import { PlatformColor, ScrollView, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MEASURING, report } from "../measure";
import { cases, features, saveResults, timings, type Mode, type Results } from "../sqliteProbe";

export default function SqliteProbe() {
  const params = useLocalSearchParams<{ rows?: string; modes?: string; cases?: string }>();
  const [lines, setLines] = useState<string[]>([]);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !(MEASURING || __DEV__)) return;
    ran.current = true;
    const sizes = (params.rows ?? "100000").split(",").map(Number).filter((n) => n > 0);
    const modes = (params.modes ?? "async,sync").split(",").filter((m): m is Mode => m === "async" || m === "sync");
    const results: Results = { started: new Date().toISOString() };
    const say = (line: string) => {
      console.warn(`[sqlite-probe] ${line}`);
      setLines((was) => [...was, line]);
    };
    const keep = async (step: string, value: unknown) => {
      results[step] = value;
      saveResults(results);
      await report({ step: `sqlite-${step}`, value });
      say(`${step}: ${JSON.stringify(value, null, 1)}`);
    };
    void (async () => {
      try {
        await keep("features", await features());
        if (params.cases !== "0") for (const mode of modes) await keep(`cases-${mode}`, await cases(mode, say));
        for (const n of sizes) for (const mode of modes) await keep(`timings-${n}-${mode}`, await timings(n, mode));
        await keep("done", true);
      } catch (error) {
        await keep("error", String(error));
      }
    })();
  }, [params.rows, params.modes, params.cases]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }}>
      {lines.map((line, i) => (
        <Text key={i} selectable style={{ fontFamily: "Menlo", fontSize: 11, color: PlatformColor("label"), marginBottom: 6 }}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}
