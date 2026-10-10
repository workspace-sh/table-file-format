// The SQLite probe (sqliteProbe.ts): what the phone's SQLite can do for the
// index, run on the device. Only in a measuring build
// (EXPO_PUBLIC_TABLE_MEASURE=1) or development, opened by a link:
//
//   sh.workspace.table.mobile://sqlite?rows=100000&modes=async,sync&cases=1&yield=50&batch=1000 (yield: ms between macrotasks)
//
// Each step is shown, posted to the measuring server (Simulator) and kept
// in the app's documents as sqlite-probe.json (a device:
// `xcrun devicectl device copy from --domain-type appDataContainer`).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PlatformColor, ScrollView, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MEASURING, report } from "../measure";
import { cases, features, heartbeat, saveResults, timings, type Mode, type Results } from "../sqliteProbe";
import { saveProbe } from "../saveProbe";

// React's own clock (sqliteProbe.ts's heartbeat): renders when asked, and says when it has committed.
function Heartbeat() {
  const [n, setN] = useState(0);
  useEffect(() => {
    heartbeat.render = () => setN((x) => x + 1);
    return () => {
      heartbeat.render = null;
    };
  }, []);
  useLayoutEffect(() => heartbeat.committed(), [n]);
  return null;
}

export default function SqliteProbe() {
  const params = useLocalSearchParams<{ rows?: string; modes?: string; cases?: string; yield?: string; batch?: string; ckpt?: string; commit?: string; save?: string }>();
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
        if (params.save) {
          // Only how long reads wait during a save, of the archive at this address.
          await keep("save", await saveProbe(params.save, say));
          await keep("done", true);
          return;
        }
        await keep("features", await features());
        if (params.cases !== "0") for (const mode of modes) await keep(`cases-${mode}`, await cases(mode, say));
        const build = { yieldAfterMs: Number(params.yield ?? 0) || undefined, batchSize: Number(params.batch ?? 0) || undefined, autocheckpoint: params.ckpt === undefined ? undefined : Number(params.ckpt), commitEvery: Number(params.commit ?? 0) || undefined };
        for (const n of sizes) for (const mode of modes) await keep(`timings-${n}-${mode}`, await timings(n, mode, build));
        await keep("done", true);
      } catch (error) {
        await keep("error", String(error));
      }
    })();
  }, [params.rows, params.modes, params.cases, params.yield, params.batch, params.ckpt, params.commit, params.save]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }}>
      <Heartbeat />
      {lines.map((line, i) => (
        <Text key={i} selectable style={{ fontFamily: "Menlo", fontSize: 11, color: PlatformColor("label"), marginBottom: 6 }}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}
