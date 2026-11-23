// Prototype for #858: reviewing a table's problems and repairing them in place.
// The row checks are the real validator's. The grouping, wording and fixes are
// provisional until the shared problem model lands.

import { useMemo, useState } from "react";
import { Alert, PlatformColor, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { validate, type Row, type TableSchema } from "@workspace.sh/table-core";

const STATUS = ["planned", "running", "done"];
const SCHEMA: TableSchema = {
  fields: [
    { id: "f-sample", name: "sample", title: "Sample", type: "string", constraints: { required: true } },
    { id: "f-reading", name: "reading", title: "Reading", type: "number", constraints: { minimum: 0, maximum: 100 } },
    { id: "f-status", name: "status", title: "Status", type: "string", constraints: { enum: STATUS } },
  ],
} as TableSchema;
const ROWS: Row[] = [
  { id: "r1", sample: "Control A", reading: 42.1, status: "done" },
  { id: "r2", sample: "Batch 2", reading: "12.5", status: "done" },
  { id: "r3", sample: "Batch 3", reading: 140, status: "running" },
  { id: "r4", sample: "Batch 4", reading: 61, status: "Done" },
  { id: "r5", reading: 18, status: "planned" },
] as Row[];

type Fix = { label: string; safe?: boolean; schema?: boolean; apply: (t: Model) => Model };
type Model = { schema: TableSchema; rows: Row[] };
type Problem = { key: string; where: string; what: string; fixes: Fix[] };

const setCell = (id: string, field: string, value: unknown) => (t: Model): Model => ({
  ...t,
  rows: t.rows.map((r) => (r.id === id ? ({ ...r, [field]: value } as Row) : r)),
});
const setConstraint = (field: string, change: (c: Record<string, unknown>) => Record<string, unknown>) => (t: Model): Model => ({
  ...t,
  schema: {
    ...t.schema,
    fields: t.schema.fields.map((f) =>
      f.name === field ? ({ ...f, constraints: change({ ...(f.constraints as Record<string, unknown>) }) } as typeof f) : f,
    ),
  },
});

function problemsOf(t: Model): Problem[] {
  return validate(t.schema, t.rows).flatMap((e) => {
    const row = t.rows.find((r) => r.id === e.rowId);
    const field = t.schema.fields.find((f) => f.name === e.field);
    if (!row || !field) return [];
    const value = (row as Record<string, unknown>)[field.name];
    const label = field.title ?? field.name;
    const name = typeof row.sample === "string" ? row.sample : `Row ${e.rowIndex + 1}`;
    const base = { key: `${row.id}:${field.name}:${e.message}`, where: `${name} · ${label}` };
    if (e.message.startsWith("expected type number") && typeof value === "string" && Number.isFinite(Number(value))) {
      return [{ ...base, what: `“${value}” is saved as text, but ${label} holds numbers.`, fixes: [{ label: `Change to ${Number(value)}`, safe: true, apply: setCell(row.id, field.name, Number(value)) }] }];
    }
    if (e.message.startsWith("above maximum")) {
      return [{ ...base, what: `${value} is above ${label}'s limit of ${field.constraints?.maximum}.`, fixes: [
        { label: "Edit value", apply: (m) => m },
        { label: `Allow up to ${value}`, schema: true, apply: setConstraint(field.name, (c) => ({ ...c, maximum: value })) },
      ] }];
    }
    if (e.message.startsWith("value not in enum")) {
      const near = STATUS.find((s) => s.toLowerCase() === String(value).toLowerCase());
      return [{ ...base, what: `“${value}” isn't one of ${label}'s options.`, fixes: [
        ...(near ? [{ label: `Change to “${near}”`, safe: true, apply: setCell(row.id, field.name, near) }] : []),
        { label: `Add “${value}”`, schema: true, apply: setConstraint(field.name, (c) => ({ ...c, enum: [...(c.enum as string[]), value] })) },
      ] }];
    }
    if (e.message === "required field is missing") {
      return [{ ...base, what: `${label} is required, and this row has none.`, fixes: [{ label: "Add value", apply: setCell(row.id, field.name, "Batch 5") }] }];
    }
    return [{ ...base, what: e.message, fixes: [] }];
  });
}

const DECISIONS = [
  { key: "dup", where: "Batch 7 · two rows share an ID", what: "These may be one sample entered twice, or two different samples.", fixes: ["Keep both", "Compare"] },
  { key: "merge", where: "Line 12 · edited on two devices", what: "Both versions were kept, and none of your data was lost.", fixes: ["Compare versions"] },
];
const STRUCTURAL = {
  where: "Two columns share an ID",
  what: "The table still opens, but edits to these columns may land in the wrong one. Your data hasn't been changed.",
  fixes: ["Restore earlier version", "Share file for help"],
};

export default function RepairScreen() {
  const [history, setHistory] = useState<Model[]>([{ schema: SCHEMA, rows: ROWS }]);
  const [gone, setGone] = useState<string[]>([]);
  const model = history[history.length - 1]!;
  const quick = useMemo(() => problemsOf(model), [model]);
  const decisions = DECISIONS.filter((d) => !gone.includes(d.key));
  const safe = quick.flatMap((p) => p.fixes.filter((f) => f.safe).slice(0, 1));
  const total = quick.length + decisions.length + 1;

  const apply = (fixes: Fix[]) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHistory((h) => [...h, fixes.reduce((m, f) => f.apply(m), h[h.length - 1]!)]);
  };
  const choose = (fix: Fix) => {
    if (!fix.schema) return apply([fix]);
    Alert.alert(fix.label, "This changes the column's rule for every row.", [
      { text: "Cancel", style: "cancel" },
      { text: "Change Rule", onPress: () => apply([fix]) },
    ]);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <SymbolView name="checkmark.shield.fill" size={26} tintColor={PlatformColor("systemGreen") as unknown as string} />
        <View style={styles.flex}>
          <Text style={styles.summaryTitle}>{total} things need a look</Text>
          <Text style={styles.secondary}>Your data is safe. You can keep working while you fix these.</Text>
        </View>
      </View>

      <Heading title="Quick fixes" count={quick.length} action={safe.length > 1 ? `Fix ${safe.length} Safely` : undefined} onAction={() => apply(safe)} />
      {quick.length === 0 ? <Text style={styles.secondary}>All done.</Text> : null}
      {quick.map((p) => (
        <Card key={p.key} where={p.where} what={p.what}>
          {p.fixes.map((f, i) => <FixButton key={f.label} label={f.label} primary={i === 0 && !!f.safe} onPress={() => choose(f)} />)}
        </Card>
      ))}

      <Heading title="Needs your decision" count={decisions.length} />
      {decisions.map((d) => (
        <Card key={d.key} where={d.where} what={d.what}>
          {d.fixes.map((label) => <FixButton key={label} label={label} onPress={() => setGone((g) => [...g, d.key])} />)}
        </Card>
      ))}

      <Heading title="File structure" count={1} />
      <Card where={STRUCTURAL.where} what={STRUCTURAL.what} symbol="exclamationmark.triangle.fill">
        {STRUCTURAL.fixes.map((label) => <FixButton key={label} label={label} onPress={() => {}} />)}
      </Card>

      {history.length > 1 ? <FixButton label="Undo Last Fix" onPress={() => setHistory((h) => h.slice(0, -1))} /> : null}
    </ScrollView>
  );
}

function Heading({ title, count, action, onAction }: { title: string; count: number; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingText}>{title} <Text style={styles.secondary}>{count}</Text></Text>
      {action ? <Pressable accessibilityRole="button" onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable> : null}
    </View>
  );
}

function Card({ where, what, symbol, children }: { where: string; what: string; symbol?: "exclamationmark.triangle.fill"; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.whereRow}>
        {symbol ? <SymbolView name={symbol} size={15} tintColor={PlatformColor("systemOrange") as unknown as string} /> : null}
        <Text style={styles.where}>{where}</Text>
      </View>
      <Text style={styles.what}>{what}</Text>
      <View style={styles.fixes}>{children}</View>
    </View>
  );
}

function FixButton({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.fix, primary && styles.fixPrimary]}>
      <Text style={[styles.fixText, primary && styles.fixPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PlatformColor("systemGroupedBackground") },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  flex: { flex: 1 },
  summary: { flexDirection: "row", gap: 12, alignItems: "center", paddingBottom: 4 },
  summaryTitle: { fontSize: 20, fontWeight: "700", color: PlatformColor("label") },
  secondary: { fontSize: 14, fontWeight: "400", color: PlatformColor("secondaryLabel") },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 },
  headingText: { fontSize: 17, fontWeight: "600", color: PlatformColor("label") },
  link: { fontSize: 15, fontWeight: "600", color: PlatformColor("link") },
  card: { gap: 6, padding: 14, borderRadius: 18, borderCurve: "continuous", backgroundColor: PlatformColor("secondarySystemGroupedBackground") },
  whereRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  where: { flex: 1, fontSize: 13, fontWeight: "600", color: PlatformColor("secondaryLabel") },
  what: { fontSize: 16, lineHeight: 21, color: PlatformColor("label") },
  fixes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  fix: { minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 18, backgroundColor: PlatformColor("tertiarySystemFill") },
  fixPrimary: { backgroundColor: PlatformColor("systemBlue") },
  fixText: { fontSize: 15, fontWeight: "600", color: PlatformColor("link") },
  fixPrimaryText: { color: "#fff" },
});
