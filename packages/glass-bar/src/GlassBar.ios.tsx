/**
 * iOS: the whole bottom group is one SwiftUI tree (one `@expo/ui` Host) in
 * one GlassEffectContainer, so its pieces are the system's Liquid Glass and
 * merge, split and morph as the system's own controls do. Each piece keeps
 * a glass identity across states:
 *
 *   lead     Filter at rest; ✕ once something is selected or edited.
 *   capsule  Search, the selected cell, or the editor.
 *   trail    More at rest; Close while searching; absorbed into the
 *            capsule while editing.
 *   chip-*   Operators, suggestions or choices, above the capsule.
 *
 * React Native decides the state and moves the group with the keyboard;
 * SwiftUI animates the change between states. The editor's field lives in
 * the tree, so focusing it raises the system keyboard with no accessory
 * view. The Host fits its content, so touches outside the controls reach
 * whatever is behind.
 */
import { useEffect, useId, useImperativeHandle, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import { Animated, Dimensions, Easing, Keyboard, PlatformColor, StyleSheet, View, useColorScheme, type KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  DatePicker,
  GlassEffectContainer,
  HStack,
  Host,
  Image,
  Menu,
  Namespace,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityLabel,
  animation,
  autocorrectionDisabled,
  datePickerStyle,
  contentShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  glassEffectId,
  keyboardType,
  lineLimit,
  onSubmit as onSubmitModifier,
  onTapGesture,
  padding,
  shapes,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import type { GlassBarEditing, GlassBarHandle, GlassBarProps, GlassBarState } from "./types";

const SIZE = 48;
const GAP = 8;
const SIDE = 16;
/** Above the keyboard, and above the home indicator at rest. */
const LIFT = 8;
const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
type Symbol = NonNullable<ComponentProps<typeof Image>["systemName"]>;

function glass(shape: "circle" | "roundedRectangle", interactive = true) {
  return glassEffect({ glass: { variant: "regular", interactive }, shape, cornerRadius: shape === "roundedRectangle" ? SIZE / 2 : undefined });
}

/** SwiftUI's animation modifier watches a number: one per layout the bar can take. */
function layoutOf(state: GlassBarState): number {
  switch (state.kind) {
    case "rest": return state.query ? 1 : 0;
    case "searching": return 2;
    case "selected": return 3;
    case "choosing": return 4;
    case "dating": return 5;
    case "editing": return 10 + (state.chips?.length ? 1 : 0) + (state.error ? 2 : 0) + (state.mode === "text" ? 4 : 0);
  }
}

/**
 * How far to raise the bar so it sits above the keyboard, animated with the
 * keyboard's own duration and curve on the native driver. (LayoutAnimation,
 * which KeyboardAvoidingView uses, doesn't animate this on the New
 * Architecture: the bar waited, then jumped.)
 */
function useKeyboardLift(rest: number): Animated.Value {
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const to = (e: KeyboardEvent, value: number) =>
      Animated.timing(lift, {
        toValue: value,
        duration: e.duration || 250,
        // Close to the keyboard's own curve (UIKit's curve 7).
        easing: Easing.bezier(0.38, 0.7, 0.125, 1),
        useNativeDriver: true,
      }).start();
    const subs = [
      Keyboard.addListener("keyboardWillChangeFrame", (e) => {
        // Only a keyboard docked at the foot of the screen lifts the bar: a
        // floating, undocked or hardware keyboard reports frames that would
        // otherwise throw it to the top of the screen.
        const { screenY, height } = e.endCoordinates;
        const docked = height > 0 && Math.abs(screenY + height - Dimensions.get("screen").height) < 2;
        to(e, docked ? -(height + LIFT - rest) : 0);
      }),
      Keyboard.addListener("keyboardWillHide", (e) => to(e, 0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [lift, rest]);
  return lift;
}

export function GlassBar(props: GlassBarProps) {
  const { state } = props;
  const ns = useId();
  const insets = useSafeAreaInsets();
  const rest = Math.max(insets.bottom - 4, LIFT);
  const lift = useKeyboardLift(rest);
  const layout = layoutOf(state);
  // The editor registers how to insert at its cursor; chips and the host app use it.
  const editor = useRef<GlassBarHandle | null>(null);
  useImperativeHandle(props.ref, () => ({ insert: (text, back) => editor.current?.insert(text, back) }), []);

  // Something above the capsule (operators, choices, a calendar): a soft
  // fade behind the group keeps it legible over the table, as a bar's
  // scroll edge does.
  const raised = (state.kind === "editing" && !!state.chips?.length) || state.kind === "choosing" || state.kind === "dating";
  const dark = useColorScheme() === "dark";
  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(e) => props.onHeight?.(e.nativeEvent.layout.height - rest)}
      style={[styles.dock, { paddingBottom: rest, transform: [{ translateY: lift }] }]}
    >
      {raised ? (
        <View
          pointerEvents="none"
          style={[
            styles.fade,
            {
              experimental_backgroundImage: dark
                ? "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.72) 38%, rgba(0,0,0,0.86))"
                : "linear-gradient(to bottom, rgba(242,242,247,0), rgba(242,242,247,0.78) 38%, rgba(242,242,247,0.9))",
            },
          ]}
        />
      ) : null}
      <Host matchContents={{ vertical: true }} ignoreSafeArea="keyboard" style={styles.host}>
        <Namespace id={ns}>
          <GlassEffectContainer
            spacing={2}
            modifiers={[
              padding({ horizontal: SIDE }),
              // The Host takes the content's height, so the content must not shrink
              // to fit the height it had before (a growing field would).
              fixedSize({ horizontal: false, vertical: true }),
              animation(Animation.spring({ duration: 0.4, bounce: 0.18 }), layout),
            ]}
          >
            <VStack alignment="leading" spacing={GAP}>
              <Chips {...props} ns={ns} editor={editor} />
              <HStack spacing={GAP} alignment="bottom">
                <Lead {...props} ns={ns} />
                <Capsule {...props} ns={ns} editor={editor} />
                <Trail {...props} ns={ns} />
              </HStack>
            </VStack>
          </GlassEffectContainer>
        </Namespace>
      </Host>
    </Animated.View>
  );
}

type Part = GlassBarProps & { ns: string; editor?: RefObject<GlassBarHandle | null> };

function Lead({ state, ns, onFilter, onDeselect, onCancel }: Part) {
  if (state.kind === "searching") return null; // absorbed into the search field
  const rest = state.kind === "rest";
  const action = rest ? onFilter : state.kind === "selected" ? onDeselect : onCancel;
  return (
    <Image
      systemName={rest ? "line.3.horizontal.decrease" : "xmark"}
      size={rest ? 19 : 17}
      onPress={action}
      modifiers={[
        frame({ width: SIZE, height: SIZE }),
        glass("circle"),
        glassEffectId("lead", ns),
        contentShape(shapes.circle()),
        accessibilityLabel(rest ? "Filter" : state.kind === "selected" ? "Deselect" : "Cancel"),
      ]}
    />
  );
}

function Trail({ state, ns, onMore, onSearchEnd, moreActions }: Part) {
  if (state.kind === "editing" || state.kind === "choosing" || state.kind === "dating") return null; // merged into the capsule
  const searching = state.kind === "searching";
  if (!searching && moreActions?.length) {
    // More is the system's menu, its button the same glass circle.
    return (
      <Menu
        label={<Image systemName="ellipsis" size={19} modifiers={[frame({ width: SIZE, height: SIZE }), foregroundStyle("primary")]} />}
        modifiers={[glass("circle"), glassEffectId("trail", ns), contentShape(shapes.circle()), accessibilityLabel("More")]}
      >
        {moreActions.map((a) => (
          <Button key={a.label} label={a.label} systemImage={a.symbol as Symbol | undefined} onPress={a.onPress} />
        ))}
      </Menu>
    );
  }
  return (
    <Image
      systemName={searching ? "xmark" : "ellipsis"}
      size={searching ? 17 : 19}
      onPress={searching ? onSearchEnd : onMore}
      modifiers={[
        frame({ width: SIZE, height: SIZE }),
        glass("circle"),
        glassEffectId("trail", ns),
        contentShape(shapes.circle()),
        accessibilityLabel(searching ? "Close search" : "More"),
      ]}
    />
  );
}

function Chips({ state, ns, onChip, onChoose, onPickDate, onAddChoice, editor }: Part) {
  const dark = useColorScheme() === "dark";
  const chips =
    state.kind === "editing" ? (state.chips ?? []).map((c) => ({ ...c, on: false, press: () => { if (c.insert) editor?.current?.insert(c.insert, c.cursorBack); onChip?.(c.id); } }))
    : state.kind === "choosing"
      ? state.choices.map((c) => ({
          ...c,
          detail: undefined,
          symbol: undefined,
          on: Array.isArray(state.selected) ? state.selected.includes(c.id) : c.id === state.selected,
          tone: c.colors ? (dark ? c.colors.dark : c.colors.light) : undefined,
          press: () => onChoose?.(c.id),
        }))
    : [];
  if (state.kind === "dating") return <DateCard state={state} ns={ns} onPickDate={onPickDate} />;
  if (chips.length === 0) return null;
  // Symbols share one glass background, as a toolbar group does: one
  // larger, steadier piece of glass reads better over a busy table than a
  // row of small ones.
  if (chips.every((c) => c.symbol)) {
    return (
      <HStack
        spacing={0}
        modifiers={[padding({ horizontal: 4 }), glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }), glassEffectId("chips", ns)]}
      >
        {chips.map((c) => (
          <Image
            key={c.id}
            systemName={c.symbol as Symbol}
            size={18}
            onPress={c.press}
            modifiers={[frame({ width: 46, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel(c.label)]}
          />
        ))}
      </HStack>
    );
  }
  // As many as there are, on one line each, scrolling sideways when they don't fit.
  const canAdd = state.kind === "choosing" && state.canAdd;
  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
    <HStack spacing={6} modifiers={[padding({ vertical: 2 })]}>
      {chips.map((c) => (
        <VStack
          key={c.id}
          alignment="leading"
          spacing={0}
          modifiers={[
            padding({ horizontal: 14, vertical: c.detail ? 6 : 9 }),
            frame({ minWidth: 44 }),
            glassEffect({ glass: { variant: "regular", interactive: true, tint: chipTint(c) }, shape: "capsule" }),
            glassEffectId(`chip-${c.id}`, ns),
            contentShape(shapes.capsule()),
            onTapGesture(c.press),
            accessibilityLabel(c.label),
          ]}
        >
          <Text modifiers={[font({ size: c.detail ? 14 : 17, weight: c.detail ? "semibold" : "regular", design: c.detail ? "monospaced" : "default" }), lineLimit(1), fixedSize({ horizontal: true, vertical: false }), ...chipLabel(c)]}>
            {c.label}
          </Text>
          {c.detail ? <Text modifiers={[font({ size: 11 }), secondary, lineLimit(1)]}>{c.detail}</Text> : null}
        </VStack>
      ))}
      {canAdd ? (
        <Image
          systemName="plus"
          size={17}
          onPress={onAddChoice}
          modifiers={[
            frame({ width: 44, height: 40 }),
            glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
            glassEffectId("chip-add", ns),
            contentShape(shapes.capsule()),
            accessibilityLabel("New choice"),
          ]}
        />
      ) : null}
    </HStack>
    </ScrollView>
  );
}

function Capsule(props: Part) {
  const { state, ns } = props;
  // contentShape: the whole capsule takes the tap, not only its text.
  const shape = [
    frame({ maxWidth: Infinity, minHeight: SIZE, alignment: "leading" }),
    glass("roundedRectangle"),
    glassEffectId("capsule", ns),
    contentShape(shapes.roundedRectangle({ cornerRadius: SIZE / 2 })),
  ];
  switch (state.kind) {
    case "rest":
      return (
        <HStack spacing={10} modifiers={[padding({ leading: 16, trailing: 12 }), ...shape, onTapGesture(() => props.onSearch?.()), accessibilityLabel("Search")]}>
          <Image systemName="magnifyingglass" size={17} modifiers={[secondary]} />
          <Text modifiers={[font({ size: 17 }), ...(state.query ? [] : [secondary]), lineLimit(1)]}>{state.query || "Search"}</Text>
          <Spacer />
          {state.query ? <Image systemName="xmark.circle.fill" size={18} color={PlatformColor("tertiaryLabel")} onPress={props.onClearQuery} modifiers={[accessibilityLabel("Clear")]} /> : null}
        </HStack>
      );
    case "searching":
      return (
        <HStack spacing={10} modifiers={[padding({ leading: 16, trailing: 12 }), ...shape]}>
          <Image systemName="magnifyingglass" size={17} modifiers={[secondary]} />
          <TextField key="search" defaultValue={state.query} placeholder="Search" autoFocus onValueChange={props.onQueryChange} />
          {state.query ? <Image systemName="xmark.circle.fill" size={18} color={PlatformColor("tertiaryLabel")} onPress={props.onClearQuery} modifiers={[accessibilityLabel("Clear")]} /> : null}
        </HStack>
      );
    case "selected":
      return (
        <VStack alignment="leading" spacing={1} modifiers={[padding({ horizontal: 16, vertical: 6 }), ...shape, onTapGesture(() => props.onEdit?.()), accessibilityLabel(`${state.label}, ${state.value}. Edit`)]}>
          <Label text={state.label} size={11} />
          <Text modifiers={[font({ size: state.monospaced ? 14 : 16, design: state.monospaced ? "monospaced" : "default" }), lineLimit(1)]}>{state.value || " "}</Text>
        </VStack>
      );
    case "choosing": {
      const picked = Array.isArray(state.selected) ? state.selected : state.selected ? [state.selected] : [];
      const text = state.choices.filter((c) => picked.includes(c.id)).map((c) => c.label).join(", ");
      return (
        <VStack alignment="leading" spacing={1} modifiers={[padding({ horizontal: 16, vertical: 6 }), ...shape]}>
          <Header label={state.label} detail={state.detail} />
          <Text modifiers={[font({ size: 16 }), lineLimit(1)]}>{text || " "}</Text>
        </VStack>
      );
    }
    case "dating":
      return (
        <VStack alignment="leading" spacing={1} modifiers={[padding({ horizontal: 16, vertical: 6 }), ...shape]}>
          <Header label={state.label} detail={state.detail} />
          <Text modifiers={[font({ size: 16 }), lineLimit(1)]}>{state.shown || " "}</Text>
        </VStack>
      );
    case "editing":
      return <Editor {...props} state={state} shape={shape} />;
  }
}

type ChipLook = { on: boolean; tone?: { bg: string; fg: string } };
/** A choice's glass: a light wash of its colour, a little stronger when it's on; else plain, or blue when on. */
function chipTint(c: ChipLook): string | undefined {
  if (c.tone) return c.tone.bg + (c.on ? "E6" : "66");
  return c.on ? "#0A84FF" : undefined;
}
function chipLabel(c: ChipLook) {
  if (c.tone) return [foregroundStyle(c.tone.fg), ...(c.on ? [font({ size: 17, weight: "semibold" })] : [])];
  return c.on ? [foregroundStyle("white")] : [];
}

/** The system's calendar (and clock), in glass above the capsule; a pick saves. */
function DateCard({ state, ns, onPickDate }: { state: Extract<GlassBarState, { kind: "dating" }>; ns: string; onPickDate?: (d: Date) => void }) {
  return (
    <VStack
      modifiers={[
        padding({ all: 12 }),
        glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: 28 }),
        glassEffectId("dates", ns),
      ]}
    >
      <DatePicker
        selection={state.value ?? new Date()}
        displayedComponents={state.components}
        onDateChange={(d) => onPickDate?.(d)}
        modifiers={[datePickerStyle("graphical")]}
      />
    </VStack>
  );
}

/** A label, its leading "ƒ " drawn as the system's function symbol. */
function Label({ text, size }: { text: string; size: number }) {
  if (!text.startsWith("ƒ ")) return <Text modifiers={[font({ size }), secondary, lineLimit(1)]}>{text}</Text>;
  return (
    <HStack spacing={3}>
      <Image systemName="function" size={size + 1} modifiers={[secondary]} />
      <Text modifiers={[font({ size }), secondary, lineLimit(1)]}>{text.slice(2)}</Text>
    </HStack>
  );
}

function Header({ label, detail }: { label: string; detail?: string }) {
  return (
    <HStack spacing={8}>
      <Label text={label} size={12} />
      <Spacer />
      {detail ? <Text modifiers={[font({ size: 12, weight: "semibold" }), lineLimit(1)]}>{detail}</Text> : null}
    </HStack>
  );
}

function Editor({ state, shape, onChange, onSave, onSubmit, onFix, editor }: Part & { state: GlassBarEditing; shape: ReturnType<typeof frame>[] }) {
  const field = useRef<TextFieldRef>(null);
  const value = useRef(state.initialValue);
  // A new edit (the next row) starts from its own value.
  useMemo(() => { value.current = state.initialValue; }, [state.editKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selection = useRef({ start: state.initialValue.length, end: state.initialValue.length });
  useMemo(() => { selection.current = { start: state.initialValue.length, end: state.initialValue.length }; }, [state.editKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Start with the cursor at the end, as editing a cell does.
  useEffect(() => {
    const end = state.initialValue.length;
    const t = setTimeout(() => void field.current?.setSelection(end, end), 50);
    return () => clearTimeout(t);
  }, [state.editKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editor) return;
    editor.current = {
      insert: (text, back = 0) => {
        const { start, end } = selection.current;
        const next = value.current.slice(0, start) + text + value.current.slice(end);
        const at = start + text.length - back;
        value.current = next;
        selection.current = { start: at, end: at };
        void field.current?.setText(next).then(() => field.current?.setSelection(at, at));
        onChange?.(next);
      },
    };
    return () => { editor.current = null; };
  });
  const grows = state.mode !== "line";
  const mono = state.mode === "formula";

  const change = (next: string) => {
    // A growing field types Return as a new line. In a formula or a short
    // value that means "save and move on", so take it as that.
    if (state.mode !== "text" && next.includes("\n")) {
      const clean = next.replace(/\n/g, "");
      void field.current?.setText(clean);
      value.current = clean;
      onSubmit?.(clean);
      return;
    }
    value.current = next;
    onChange?.(next);
  };

  return (
    <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: 16, trailing: 6, top: 9, bottom: 6 }), ...shape]}>
      <Header label={state.label} detail={state.detail} />
      <HStack spacing={8} alignment="bottom">
        <TextField
          key={state.editKey}
          ref={field}
          defaultValue={state.initialValue}
          autoFocus
          axis={grows ? "vertical" : "horizontal"}
          onValueChange={change}
          onSelectionChange={(sel) => { selection.current = sel; }}
          modifiers={[
            font({ size: mono ? 15 : 17, design: mono ? "monospaced" : "default" }),
            // A growing field takes the height of its lines rather than what it is offered.
            ...(grows ? [lineLimit(5), fixedSize({ horizontal: false, vertical: true })] : []),
            ...(state.keyboard && state.keyboard !== "default" ? [keyboardType(state.keyboard)] : []),
            // A number, code or formula: no word suggestions, corrections or capitals.
            ...(state.suggestions === false ? [autocorrectionDisabled(true), textInputAutocapitalization("never")] : []),
            // A one-line field reports Return as a submit, not a new line.
            ...(grows ? [] : [onSubmitModifier(() => onSubmit?.(value.current))]),
            padding({ vertical: 4 }),
          ]}
        />
        <Image
          systemName="checkmark.circle.fill"
          size={32}
          color={state.error ? "#C7C7CC" : "#0A84FF"}
          onPress={state.error ? undefined : () => onSave?.(value.current)}
          modifiers={[accessibilityLabel("Save")]}
        />
      </HStack>
      {state.error ? (
        <HStack spacing={10} modifiers={[padding({ bottom: 4 })]}>
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#D70015")]}>{state.error.message}</Text>
          {state.error.fixLabel ? (
            <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#D70015"), onTapGesture(() => onFix?.())]}>{state.error.fixLabel}</Text>
          ) : null}
        </HStack>
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  host: { width: "100%" },
  /** Behind the group, rising a little above it. */
  fade: { position: "absolute", left: 0, right: 0, top: -36, bottom: 0 },
});
