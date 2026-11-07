/**
 * Android: a formula's editor, docked above the keyboard, as a spreadsheet's
 * formula bar is on Android. Every other cell is edited where it is, with
 * Material's own controls (its menus and date dialogs): the host gives the
 * table this bar's editor with `formulasOnly` (useGlassEditor), so only
 * formulas come here, and the bar draws nothing at other times.
 *
 * What it holds, top to bottom: what's edited and this row's result; the
 * columns as chips, a tap adding one at the cursor (as a tap on a cell
 * does); the formula, coloured as it's typed; why it can't be saved, with
 * its fix; and, when opened, how it's worked out. Close discards, Save
 * keeps, as the iPhone's bar does. Its buttons and chips are Material's own
 * (Compose's, from @expo/ui); the field is React Native's, which takes its
 * text as coloured spans (Compose's TextField in @expo/ui takes plain text).
 */
import { useEffect, useImperativeHandle, useRef, useState, type ReactElement } from "react";
import { AppState, BackHandler, Keyboard, Pressable, ScrollView, Text, TextInput, View, useColorScheme, type ImageSourcePropType, type TextInputSelectionChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AssistChip,
  Button,
  Column,
  FilledTonalButton,
  Host,
  Icon,
  IconButton,
  Row,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, horizontalScroll, padding, weight } from "@expo/ui/jetpack-compose/modifiers";
import type { GlassBarEditing, GlassBarProps, GlassBarSpan } from "./types";
import { androidBarInset } from "./keyboardInset";

// Material Symbols (weight 400) as vector drawables, which Compose's Icon draws.
const symbols = {
  close: require("./material/close.xml"),
} satisfies Record<string, ImageSourcePropType>;

// A formula's colours, by kind: Material's tones of the roles iOS uses (blue, purple, green, orange).
const spanColours = {
  light: { ref: "#0B57D0", fn: "#7B1FA2", str: "#146C2E", num: "#B45309", op: "#49454F" },
  dark: { ref: "#A8C7FA", fn: "#E1A6F0", str: "#6DD58C", num: "#FFB870", op: "#CAC4D0" },
};

export function GlassBar(props: GlassBarProps): ReactElement | null {
  if (props.state.kind !== "editing") return null;
  return <FormulaBar key={props.state.editKey} {...props} state={props.state} />;
}

function FormulaBar({ state, ref, onCancel, onChange, onSave, onSubmit, onChip, onFix, onPrefixRemove, onFieldSettings, onHeight }: GlassBarProps & { state: GlassBarEditing }) {
  const dark = useColorScheme() === "dark";
  // The system's colours (Material You's dynamic colour, where the phone has it).
  const p = useMaterialColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(state.initialValue);
  const selection = useRef({ start: state.initialValue.length, end: state.initialValue.length });
  const [cursor, setCursor] = useState<{ start: number; end: number } | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const input = useRef<TextInput>(null);

  // Docked on the keyboard: Android reports its height as it shows.
  useEffect(() => {
    const subs = [
      Keyboard.addListener("keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height + androidBarInset())),
      Keyboard.addListener("keyboardDidHide", () => setKeyboard(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  // Back, once the keyboard is down (the first Back puts it away), closes the bar as Cancel does,
  // rather than leaving the screen with the formula half written.
  const latest = useRef({ text, onCancel, onSave, initial: state.initialValue });
  latest.current = { text, onCancel, onSave, initial: state.initialValue };
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      latest.current.onCancel?.();
      return true;
    });
    // Going to the background saves what was typed, as scrolling the table away does: the app may not come back.
    const away = AppState.addEventListener("change", (next) => {
      const { text: now, initial, onSave: save } = latest.current;
      if (next !== "active" && now !== initial) save?.(now);
    });
    return () => {
      back.remove();
      away.remove();
    };
  }, []);

  const change = (next: string) => {
    setText(next);
    onChange?.(next);
  };
  const insert = (piece: string, cursorBack = 0) => {
    const { start, end } = selection.current;
    const next = text.slice(0, start) + piece + text.slice(end);
    const at = start + piece.length - cursorBack;
    selection.current = { start: at, end: at };
    setCursor({ start: at, end: at });
    change(next);
    input.current?.focus();
  };
  // A tap on a cell while writing (the host's tapWhileEditing) inserts its reference here.
  useImperativeHandle(ref, () => ({ insert }));

  const spans = state.highlight?.(text) ?? [];
  const mono = state.mode === "formula";
  return (
    <View
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: keyboard > 0 ? keyboard : 0,
        paddingBottom: keyboard > 0 ? 8 : 8 + insets.bottom,
        backgroundColor: p.surfaceContainerHigh,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        elevation: 6,
      }}
    >
      <Host matchContents={{ vertical: true }}>
        <Column modifiers={[fillMaxWidth()]}>
          <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(4, 4, 8, 0)]}>
            <IconButton onClick={() => onCancel?.()}>
              <Icon source={symbols.close} size={24} tint={p.onSurfaceVariant} contentDescription="Cancel" />
            </IconButton>
            <Column modifiers={[weight(1)]}>
              <ComposeText maxLines={1} style={{ typography: "titleSmall" }} color={p.onSurface}>
                {state.label}
              </ComposeText>
              {state.detail !== undefined ? (
                <ComposeText maxLines={1} style={{ typography: "bodySmall" }} color={p.onSurfaceVariant}>
                  {state.detail}
                </ComposeText>
              ) : null}
            </Column>
            <Button onClick={() => onSave?.(text)}>
              <ComposeText>Save</ComposeText>
            </Button>
          </Row>
          {state.chips?.length ? (
            // The columns (or operators) a tap adds at the cursor.
            <Row horizontalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth(), horizontalScroll(), padding(12, 0, 12, 0)]}>
              {state.chips.map((chip) => (
                <AssistChip
                  key={chip.id}
                  onClick={() => {
                    if (chip.insert) insert(chip.insert, chip.cursorBack);
                    onChip?.(chip.id);
                  }}
                >
                  <AssistChip.Label>
                    <ComposeText>{chip.detail ? `${chip.label}  ${chip.detail}` : chip.label}</ComposeText>
                  </AssistChip.Label>
                </AssistChip>
              ))}
            </Row>
          ) : null}
        </Column>
      </Host>

      <View style={{ flexDirection: "row", alignItems: "flex-start", marginHorizontal: 12, marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: state.error ? p.error : p.outline, backgroundColor: p.surfaceContainerLowest, paddingHorizontal: 12 }}>
        {state.prefix !== undefined && (
          <Pressable
            disabled={!state.prefixRemovable}
            accessibilityRole={state.prefixRemovable ? "button" : undefined}
            accessibilityLabel={state.prefixRemovable ? `Remove ${state.prefix}` : undefined}
            onPress={onPrefixRemove}
            style={{ paddingVertical: 10, paddingRight: 4 }}
          >
            <Text style={{ fontSize: 16, color: p.onSurfaceVariant, fontFamily: mono ? "monospace" : undefined }}>{state.prefix}</Text>
          </Pressable>
        )}
        <TextInput
          ref={input}
          autoFocus
          multiline={state.mode !== "line"}
          // Return saves a formula; long text takes it as a new line.
          submitBehavior={state.mode === "text" ? "newline" : "submit"}
          onSubmitEditing={() => onSubmit?.(text)}
          onChangeText={change}
          onKeyPress={(e) => {
            const { start, end } = selection.current;
            if (e.nativeEvent.key === "Backspace" && start === 0 && end === 0 && state.prefixRemovable) onPrefixRemove?.();
          }}
          selection={cursor}
          onSelectionChange={(e: TextInputSelectionChangeEvent) => {
            selection.current = e.nativeEvent.selection;
            if (cursor) setCursor(undefined);
          }}
          autoCorrect={state.suggestions !== false && !mono}
          autoCapitalize={state.suggestions === false || mono ? "none" : "sentences"}
          // A formula, a column's or a cell's own, is typed on letters.
          keyboardType={mono || state.prefixRemovable !== undefined ? "default" : (state.keyboard ?? "default")}
          style={{ flex: 1, fontSize: 16, color: p.onSurface, fontFamily: mono ? "monospace" : undefined, paddingVertical: 10, maxHeight: 5 * 22 + 20, textAlignVertical: "top" }}
        >
          {/* The formula in its colours: React Native's field takes its text as spans. */}
          <Coloured text={text} spans={spans} colours={dark ? spanColours.dark : spanColours.light} />
        </TextInput>
      </View>

      {state.error ? (
        <Text style={{ fontSize: 12, color: p.error, marginHorizontal: 16, marginTop: 6 }}>{state.error.message}</Text>
      ) : null}
      {state.error?.fixLabel || state.working || onFieldSettings ? (
        <Host matchContents={{ vertical: true }}>
          <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth(), padding(8, 4, 8, 0)]}>
            {state.error?.fixLabel ? (
              <FilledTonalButton onClick={() => onFix?.()}>
                <ComposeText>{state.error.fixLabel}</ComposeText>
              </FilledTonalButton>
            ) : null}
            {state.working ? (
              <TextButton onClick={() => setWorking((w) => !w)}>
                <ComposeText>{working ? "Hide Working" : "Show Working"}</ComposeText>
              </TextButton>
            ) : null}
            {onFieldSettings ? (
              <TextButton onClick={() => onFieldSettings()}>
                <ComposeText>Field Settings…</ComposeText>
              </TextButton>
            ) : null}
          </Row>
        </Host>
      ) : null}
      {working && state.working && (
        <ScrollView style={{ maxHeight: 180, marginHorizontal: 16 }} keyboardShouldPersistTaps="always">
          {state.working.sections.map((section, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              {section.title !== undefined && <Text style={{ fontSize: 12, fontWeight: "500", color: p.primary, marginBottom: 2 }}>{section.title}</Text>}
              {section.rows.map((row, j) => (
                <View key={j} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 14, color: p.onSurfaceVariant, flexShrink: 1 }}>{row.label}</Text>
                  <Text style={{ fontSize: 14, color: p.onSurface, fontWeight: row.strong ? "600" : "400" }}>{row.value}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Coloured({ text, spans, colours }: { text: string; spans: GlassBarSpan[]; colours: Record<GlassBarSpan["kind"], string> }) {
  const parts: ReactElement[] = [];
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start < at || span.end > text.length) continue;
    if (span.start > at) parts.push(<Text key={`t${at}`}>{text.slice(at, span.start)}</Text>);
    parts.push(
      <Text key={`s${span.start}`} style={{ color: colours[span.kind] }}>
        {text.slice(span.start, span.end)}
      </Text>,
    );
    at = span.end;
  }
  if (at < text.length) parts.push(<Text key={`t${at}`}>{text.slice(at)}</Text>);
  return <>{parts}</>;
}
