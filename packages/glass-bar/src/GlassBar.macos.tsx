/**
 * macOS: a formula being written, as iOS's bar shows it, drawn for an
 * inspector, the Mac's place for what's selected. A bar docked at the foot
 * of the screen is a phone's pattern; here the same state fills a panel
 * the host puts in its trailing inspector pane, on the pane's own
 * material: the formula's field, the operators, this row's result or
 * what's wrong with it (with the fix), and how it's worked out, as it's
 * typed. Return saves, Escape cancels.
 *
 * Nothing else is drawn here. Search is in the window's toolbar on a Mac;
 * a value, a choice or a date is edited in its cell (useGlassEditor's
 * `formulasOnly`); and a cell that's only selected is said by the host in
 * the system's own form, from the hook's `selection`.
 *
 * Driven by the same state and callbacks as GlassBar.ios.tsx; only the
 * drawing is the Mac's.
 */
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";
import type { GlassBarEditing, GlassBarProps, GlassBarSpan } from "./types";

const MONO = "Menlo";

/** A formula's colours, by what each stretch is: light, then dark. */
const SPAN_COLOURS: Record<GlassBarSpan["kind"], [string, string]> = {
  ref: ["#0a5ad6", "#6cb0ff"],
  fn: ["#8a2bb5", "#d08cf2"],
  str: ["#b3261e", "#ff8a80"],
  num: ["#1b7f3b", "#7ddc98"],
  op: ["#6e6e73", "#a1a1a8"],
};

export function GlassBar(props: GlassBarProps): ReactNode {
  const { state } = props;
  const dark = useColorScheme() === "dark";
  if (state.kind !== "editing") return null;
  return (
    <View onLayout={(e) => props.onHeight?.(e.nativeEvent.layout.height)}>
      <Editor
        key={state.editKey}
        state={state}
        barProps={props}
        ink={dark ? "#f5f5f7" : "#1c1c1e"}
        dim={dark ? "#a1a1a8" : "#6e6e73"}
        dark={dark}
      />
    </View>
  );
}

function Editor({
  state,
  barProps,
  ink,
  dim,
  dark,
}: {
  state: GlassBarEditing;
  barProps: GlassBarProps;
  ink: string;
  dim: string;
  dark: boolean;
}) {
  const [text, setText] = useState(state.initialValue);
  // Where the cursor is, for an operator or a clicked cell's name to go in at.
  const caret = useRef({ start: state.initialValue.length, end: state.initialValue.length });
  // Placed at the end as the field opens (a Mac text field would otherwise
  // select everything, and the first key typed would replace the formula).
  const [moveTo, setMoveTo] = useState<{ start: number; end: number } | undefined>({
    start: state.initialValue.length,
    end: state.initialValue.length,
  });
  const field = useRef<TextInput>(null);

  const change = (next: string) => {
    setText(next);
    barProps.onChange?.(next);
  };
  const insert = (piece: string, cursorBack = 0) => {
    const { start, end } = caret.current;
    const next = text.slice(0, start) + piece + text.slice(end);
    const at = start + piece.length - cursorBack;
    caret.current = { start: at, end: at };
    setMoveTo({ start: at, end: at });
    change(next);
    field.current?.focus();
  };
  useImperativeHandle(barProps.ref, () => ({ insert }));
  // The cursor is placed once, then left to the field again.
  useEffect(() => {
    if (moveTo) setMoveTo(undefined);
  }, [moveTo]);

  const spans = state.highlight?.(text);
  return (
    <View style={styles.editor}>
      <View style={styles.header}>
        <Text numberOfLines={2} style={[styles.label, { color: dim }]}>
          {state.label}
        </Text>
        {state.detail !== undefined && (
          <Text numberOfLines={1} style={[styles.label, { color: dim }]}>
            {state.detail}
          </Text>
        )}
      </View>
      {state.working && (
        <View style={styles.working}>
          {state.working.sections.map((section, s) => (
            <View key={s} style={styles.section}>
              {section.title !== undefined && <Text style={[styles.sectionTitle, { color: dim }]}>{section.title}</Text>}
              {section.rows.map((row, r) => (
                <View key={r} style={styles.workingRow}>
                  <Text numberOfLines={1} style={[styles.workingLabel, { color: row.strong ? ink : dim }, row.strong && styles.strong]}>
                    {row.label}
                  </Text>
                  <Text numberOfLines={1} style={[styles.workingValue, { color: ink }, row.strong && styles.strong]}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          ))}
          {barProps.onFieldSettings && (
            <Pressable onPress={barProps.onFieldSettings}>
              <Text style={[styles.link, { color: dark ? "#6cb0ff" : "#0a5ad6" }]}>Field Settings…</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.row}>
        {state.prefix !== undefined && <Text style={[styles.value, { color: dim }]}>{state.prefix}</Text>}
        <TextInput
          ref={field}
          autoFocus
          // A formula shows its colours in the field itself, as styled runs; anything else is plain text.
          {...(spans && spans.length > 0 ? {} : { value: text })}
          // Long formulas wrap rather than run out of the field; Return still saves.
          multiline={state.mode === "formula"}
          submitKeyEvents={state.mode === "formula" ? [{ key: "Enter" }] : undefined}
          selection={moveTo}
          onChangeText={change}
          onSelectionChange={(e) => (caret.current = e.nativeEvent.selection)}
          onSubmitEditing={() => barProps.onSubmit?.(text)}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Escape") barProps.onCancel?.();
          }}
          autoCorrect={false}
          spellCheck={false}
          style={[styles.field, { color: ink, backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }, state.mode === "formula" && styles.mono]}
        >
          {spans && spans.length > 0 ? coloured(text, spans, dark) : undefined}
        </TextInput>
      </View>
      <View style={styles.foot}>
        {state.chips?.map((chip) => (
          <Pressable
            key={chip.id}
            accessibilityLabel={chip.label}
            onPress={() => {
              if (chip.insert !== undefined) insert(chip.insert, chip.cursorBack);
              barProps.onChip?.(chip.id);
            }}
            style={[styles.chip, { borderColor: dark ? "#48484d" : "#c7c7cc" }]}
          >
            <Text style={[styles.chipText, { color: ink }]}>{chip.insert?.trim() || chip.label}</Text>
          </Pressable>
        ))}
        {state.error && (
          <View style={styles.error}>
            <Text numberOfLines={2} style={[styles.errorText, { color: dark ? "#ff8a80" : "#b3261e" }]}>
              {state.error.message}
            </Text>
            {state.error.fixLabel !== undefined && (
              <Pressable onPress={barProps.onFix} style={[styles.chip, { borderColor: dark ? "#48484d" : "#c7c7cc" }]}>
                <Text style={[styles.chipText, { color: ink }]}>{state.error.fixLabel}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable onPress={barProps.onCancel} style={[styles.button, { borderColor: dark ? "#48484d" : "#c7c7cc" }]}>
          <Text style={[styles.buttonText, { color: ink }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => barProps.onSave?.(text)}
          disabled={!!state.error}
          style={[styles.button, styles.primary, { backgroundColor: state.error ? (dark ? "#3a3a3f" : "#d1d1d6") : "#0a84ff" }]}
        >
          <Text style={styles.primaryText}>Save for Every Row</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The text as runs, each stretch of a formula in its colour. */
function coloured(text: string, spans: GlassBarSpan[], dark: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start < at || span.end > text.length) continue;
    if (span.start > at) out.push(text.slice(at, span.start));
    out.push(
      <Text key={span.start} style={{ color: SPAN_COLOURS[span.kind][dark ? 1 : 0] }}>
        {text.slice(span.start, span.end)}
      </Text>,
    );
    at = span.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "600" },
  value: { fontSize: 14 },
  mono: { fontFamily: MONO, fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 10, paddingHorizontal: 0 },
  button: { height: 26, paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 13 },
  primary: { borderWidth: 0 },
  primaryText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  editor: { padding: 16, gap: 10 },
  header: { gap: 2 },
  working: { gap: 8 },
  section: { gap: 3 },
  sectionTitle: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  workingRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  workingLabel: { fontSize: 12, flexShrink: 1 },
  workingValue: { fontSize: 12, fontVariant: ["tabular-nums"] },
  strong: { fontWeight: "600" },
  link: { fontSize: 12, paddingTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { flex: 1, minHeight: 30, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14 },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: { minWidth: 30, height: 24, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13, fontFamily: MONO },
  error: { gap: 6, flexBasis: "100%" },
  errorText: { fontSize: 12 },
});
