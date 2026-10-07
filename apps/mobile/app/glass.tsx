// A proving ground for the glass bar (#352): a small table and every state
// the bar has, wired as the table will wire it. Open it with
// sh.workspace.table.mobile://glass. Not linked from the app.

import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { GlassBar, type GlassBarHandle, type GlassBarState } from "@workspace.sh/glass-bar";

type Row = { id: string; title: string; owner: string; status: string; budget: number; spent: number; fees: number };
type Col = "title" | "owner" | "status" | "budget" | "left";
const COLS: { key: Col; label: string; width: number; numeric?: boolean }[] = [
  { key: "title", label: "TITLE", width: 150 },
  { key: "owner", label: "OWNER", width: 90 },
  { key: "status", label: "STATUS", width: 104 },
  { key: "budget", label: "BUDGET", width: 90, numeric: true },
  { key: "left", label: "LEFT", width: 90, numeric: true },
];
const STATUSES = ["active", "planning", "on-hold", "done"];
const SEED: Row[] = [
  ["Workspace v1", "lena", "active", 40000, 31500, 2000], ["Table file format", "lena", "done", 12000, 11400, 600],
  ["iOS Pro launch", "lena", "planning", 60000, 18200, 3000], ["Web companion app", "chloe", "planning", 25000, 9800, 1200],
  ["Sync engine", "chloe", "on-hold", 30000, 22100, 1500], ["Brand redesign", "sam", "done", 15000, 14700, 700],
  ["Docs site", "sam", "active", 8000, 3900, 300], ["Plugin SDK", "chloe", "planning", 20000, 4400, 900],
  ["Onboarding flow", "sam", "active", 10000, 6300, 400], ["Encrypted vaults", "lena", "on-hold", 35000, 12000, 1800],
  ["Search v2", "chloe", "active", 18000, 11200, 800], ["Q2 marketing site", "sam", "done", 9000, 8800, 500],
].map(([title, owner, status, budget, spent, fees], i) => ({ id: `r${i}`, title, owner, status, budget, spent, fees }) as Row);

const OPS = [
  { id: "+", label: "Plus", symbol: "plus", insert: " + " },
  { id: "-", label: "Minus", symbol: "minus", insert: " - " },
  { id: "*", label: "Times", symbol: "multiply", insert: " * " },
  { id: "/", label: "Divided by", symbol: "divide", insert: " / " },
  { id: "()", label: "Brackets", symbol: "parentheses", insert: "()", cursorBack: 1 },
];
const FIELD_OF: Record<string, keyof Row> = { budget: "budget", spent: "spent", fees: "fees" };

/** A tiny evaluator for the proving ground: field names, numbers, + − × ÷ and brackets. */
function evaluate(formula: string, row: Row): number | { error: string; fix?: string } {
  const src = formula.trim().replace(/^=/, "");
  const open = (src.match(/\(/g) ?? []).length - (src.match(/\)/g) ?? []).length;
  if (open > 0) return { error: "This bracket isn’t closed.", fix: ")" };
  const toks = src.match(/\d+(\.\d+)?|[a-z_]+|[-+*/()]/gi) ?? [];
  let i = 0;
  const num = (): number => {
    const t = toks[i++];
    if (t === undefined) throw new Error("Something is missing at the end.");
    if (t === "(") { const v = sum(); i++; return v; }
    if (t === "-") return -num();
    if (/^\d/.test(t)) return Number(t);
    const f = FIELD_OF[t.toLowerCase()];
    if (!f) throw new Error(`There’s no column called ${t}.`);
    return row[f] as number;
  };
  const prod = (): number => { let v = num(); while (toks[i] === "*" || toks[i] === "/") { const op = toks[i++]; const r = num(); v = op === "*" ? v * r : v / r; } return v; };
  const sum = (): number => { let v = prod(); while (toks[i] === "+" || toks[i] === "-") { const op = toks[i++]; const r = prod(); v = op === "+" ? v + r : v - r; } return v; };
  try { const v = sum(); if (i < toks.length) throw new Error("Something extra is at the end."); return v; }
  catch (e) { return { error: (e as Error).message }; }
}

const money = (n: number) => Math.round(n).toLocaleString("en-GB");

export default function GlassProvingGround() {
  const dark = useColorScheme() === "dark";
  const bar = useRef<GlassBarHandle>(null);
  const [rows, setRows] = useState(SEED);
  const [formula, setFormula] = useState("=budget - spent");
  const [draftFormula, setDraftFormula] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<{ row: number; col: Col } | null>(null);
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const lastTap = useRef(0);

  const shown = useMemo(() => rows.map((r, i) => ({ r, i })).filter(({ r }) => !query || r.title.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const live = draftFormula ?? formula;
  const leftOf = (r: Row) => evaluate(live, r);
  const selRow = sel ? rows[sel.row] : undefined;

  const valueOf = (r: Row, c: Col): string => {
    if (c === "left") { const v = leftOf(r); return typeof v === "number" ? money(v) : "!"; }
    if (c === "budget") return money(r.budget);
    return r[c];
  };
  const labelOf = (c: Col) => COLS.find((x) => x.key === c)!.label.toLowerCase().replace(/^./, (m) => m.toUpperCase());

  const save = (text: string, move: boolean) => {
    if (!sel) return;
    if (sel.col === "left") {
      if (typeof evaluate(text, rows[sel.row]) !== "number") return;
      setFormula(text); setDraftFormula(null);
    } else {
      setRows((rs) => rs.map((r, i) => i !== sel.row ? r : { ...r, [sel.col]: sel.col === "budget" ? Number(text.replace(/[^\d.]/g, "")) || 0 : text }));
    }
    if (move && sel.col !== "left" && sel.row + 1 < rows.length) {
      const next = { row: sel.row + 1, col: sel.col };
      setSel(next);
      setEditing({ key: `${next.row}:${next.col}:${Date.now()}`, text: valueOf(rows[next.row], next.col) });
    } else {
      setEditing(null);
      Keyboard.dismiss();
    }
  };

  const tapCell = (row: number, col: Col) => {
    // Writing a formula, a tap after an operator adds that column.
    if (editing && sel?.col === "left" && col !== "title" && col !== "owner" && col !== "status" && /[-+*/(=]\s*$/.test(live)) {
      bar.current?.insert(col === "left" ? "left" : col);
      return;
    }
    if (editing) save(editing.text, false);
    const now = Date.now();
    const same = sel?.row === row && sel.col === col;
    if (same && now - lastTap.current < 350) startEdit(row, col);
    else if (same && !editing) setSel(null);
    else setSel({ row, col });
    lastTap.current = now;
  };

  const startEdit = (row: number, col: Col) => {
    setSel({ row, col });
    if (col === "status") { setEditing(null); setChoosing(true); return; }
    const text = col === "left" ? formula : col === "budget" ? String(rows[row].budget) : rows[row][col];
    setEditing({ key: `${row}:${col}:${Date.now()}`, text });
  };
  const [choosing, setChoosing] = useState(false);

  let state: GlassBarState;
  if (searching) state = { kind: "searching", query };
  else if (sel && choosing) state = { kind: "choosing", label: "Status", detail: rows[sel.row].title, choices: STATUSES.map((s) => ({ id: s, label: s })), selected: rows[sel.row].status };
  else if (sel && editing) {
    const formulaCol = sel.col === "left";
    const err = formulaCol ? evaluate(live, rows[sel.row]) : 0;
    state = {
      kind: "editing",
      editKey: editing.key,
      label: formulaCol ? (/[-+*/(=]\s*$/.test(live) ? "Tap a column to add it" : "ƒ Left · every row") : labelOf(sel.col),
      detail: formulaCol ? (typeof err === "number" ? `${rows[sel.row].title}  ${money(err)}` : undefined) : rows[sel.row].title,
      initialValue: editing.text,
      mode: formulaCol ? "formula" : "line",
      keyboard: sel.col === "budget" ? "decimal-pad" : "default",
      chips: formulaCol ? OPS : undefined,
      error: typeof err === "number" ? undefined : { message: err.error, fixLabel: err.fix ? `Add ${err.fix}` : undefined },
    };
  } else if (sel && selRow) state = { kind: "selected", label: sel.col === "left" ? `ƒ Left · every row · ${selRow.title}` : `${labelOf(sel.col)} · ${selRow.title}`, value: sel.col === "left" ? formula : valueOf(selRow, sel.col), monospaced: sel.col === "left" };
  else state = { kind: "rest", query };

  const c = dark ? darkColors : lightColors;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: "All projects", headerLargeTitleEnabled: true, headerTransparent: true, headerBlurEffect: undefined }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" onScrollBeginDrag={() => editing && save(editing.text, false)} contentContainerStyle={{ paddingBottom: 140 }}>
        <Text style={[styles.sub, { color: c.sub }]}>{query ? `${shown.length} of ${rows.length} rows match “${query}”` : `${rows.length} rows`}</Text>
        <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16 }}>
          <View style={[styles.table, { backgroundColor: c.card, borderColor: c.line }]}>
            <View style={[styles.tr, { backgroundColor: c.head, borderColor: c.line }]}>
              {COLS.map((col) => <Text key={col.key} style={[styles.th, { width: col.width, color: c.sub }, col.numeric && styles.num]}>{col.label}</Text>)}
            </View>
            {shown.map(({ r, i }) => (
              <View key={r.id} style={[styles.tr, { borderColor: c.line }]}>
                {COLS.map((col) => {
                  const on = sel?.row === i && sel.col === col.key;
                  const tint = editing && sel?.col === "left" && /\b(budget|spent)\b/.test(live) && col.key === "budget" ? c.refA : col.key === "left" && editing && sel?.col === "left" ? c.colhi : undefined;
                  const text = on && editing && col.key !== "left" ? editing.text : valueOf(r, col.key);
                  return (
                    <Pressable key={col.key} onPress={() => tapCell(i, col.key)} style={[styles.td, { width: col.width, borderColor: c.line, backgroundColor: tint }, on && { borderColor: "#0A84FF", borderWidth: 2, backgroundColor: c.colhi }]}>
                      <Text numberOfLines={1} style={[styles.cell, { color: text === "!" ? "#FF3B30" : c.text }, col.numeric && styles.num]}>{text}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      <GlassBar
        ref={bar}
        state={state}
        onSearch={() => setSearching(true)}
        onQueryChange={setQuery}
        onSearchEnd={() => { setSearching(false); Keyboard.dismiss(); }}
        onClearQuery={() => setQuery("")}
        onDeselect={() => setSel(null)}
        onEdit={() => sel && startEdit(sel.row, sel.col)}
        onCancel={() => { setEditing(null); setChoosing(false); setDraftFormula(null); Keyboard.dismiss(); }}
        onChange={(t) => { if (sel?.col === "left") setDraftFormula(t); setEditing((e) => (e ? { ...e, text: t } : e)); }}
        onSave={(t) => save(t, false)}
        onSubmit={(t) => save(t, true)}
        onFix={() => bar.current?.insert(")")}
        onChoose={(id) => { if (sel) setRows((rs) => rs.map((r, i) => (i === sel.row ? { ...r, status: id } : r))); setChoosing(false); }}
        onFilter={() => {}}
        onMore={() => {}}
      />
    </View>
  );
}

const lightColors = { bg: "#F2F2F7", card: "#FFFFFF", head: "#F7F7F9", line: "#E5E5EA", text: "#1C1C1E", sub: "#6E6E73", colhi: "#EEF5FF", refA: "rgba(10,132,255,0.13)" };
const darkColors = { bg: "#000000", card: "#1C1C1E", head: "#242426", line: "#38383A", text: "#F5F5F7", sub: "#98989F", colhi: "#0B2A4A", refA: "rgba(10,132,255,0.25)" };

const styles = StyleSheet.create({
  sub: { fontSize: 14, marginHorizontal: 16, marginBottom: 12 },
  table: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tr: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  th: { fontSize: 12, letterSpacing: 0.4, paddingHorizontal: 10, paddingVertical: 9 },
  td: { height: 44, justifyContent: "center", paddingHorizontal: 10, borderLeftWidth: StyleSheet.hairlineWidth },
  cell: { fontSize: 15 },
  num: { textAlign: "right", fontVariant: ["tabular-nums"] },
});
