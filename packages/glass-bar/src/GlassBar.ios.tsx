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
 * Expanded (#354), the editor's capsule grows to just under the navigation
 * bar for long text or a long formula, and ✕, the operators and Save move
 * inside it, along its foot. The field itself stays where it is in the
 * tree, so expanding and collapsing keep its text, cursor and keyboard.
 *
 * React Native decides the state and moves the group with the keyboard;
 * SwiftUI animates the change between states. The editor's field lives in
 * the tree, so focusing it raises the system keyboard with no accessory
 * view. The Host fits its content, so touches outside the controls reach
 * whatever is behind.
 */
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type RefObject } from "react";
import { Animated, Dimensions, Easing, Keyboard, PlatformColor, StyleSheet, View, useColorScheme, useWindowDimensions, type KeyboardEvent } from "react-native";
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
  background,
  datePickerStyle,
  contentShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  glassEffectId,
  keyboardType,
  layoutPriority,
  lineLimit,
  opacity,
  onSubmit as onSubmitModifier,
  onTapGesture,
  padding,
  shapes,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { FormulaField } from "./FormulaField.ios";
import type { GlassBarEditing, GlassBarHandle, GlassBarProps, GlassBarState, GlassBarWorking } from "./types";

const SIZE = 48;
const GAP = 8;
const SIDE = 16;
/** Above the keyboard, and above the home indicator at rest. */
const LIFT = 8;
/** The navigation bar under the status bar: an expanded editor stops short of it. */
const NAV = 60;
/** And short of one row more, so the cell being edited can stay in view above it. */
const PEEK = 84;
/** How long the bar's spring between states takes. */
const SPRING_MS = 400;
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
function useKeyboardLift(rest: number): { lift: Animated.Value; keyboard: number } {
  const lift = useRef(new Animated.Value(0)).current;
  // The docked keyboard's height, or 0: what an expanded editor stands on.
  const [keyboard, setKeyboard] = useState(0);
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
        setKeyboard(docked ? height : 0);
      }),
      Keyboard.addListener("keyboardWillHide", (e) => {
        to(e, 0);
        setKeyboard(0);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [lift, rest]);
  return { lift, keyboard };
}

export function GlassBar(props: GlassBarProps) {
  const { state } = props;
  const ns = useId();
  const insets = useSafeAreaInsets();
  const rest = Math.max(insets.bottom - 4, LIFT);
  const { lift, keyboard } = useKeyboardLift(rest);
  const window = useWindowDimensions();
  // Long text and formulas can take more of the screen; a short value never needs it.
  const canExpand = state.kind === "editing" && (state.mode !== "line" || !!state.expandable);
  const [expandedWanted, setExpanded] = useState(false);
  useEffect(() => { if (!canExpand) setExpanded(false); }, [canExpand]);
  const expanded = canExpand && expandedWanted;
  const onExpandChange = useRef(props.onExpandChange);
  onExpandChange.current = props.onExpandChange;
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) { settled.current = true; return; }
    onExpandChange.current?.(expanded);
  }, [expanded]);
  // Expanded, the capsule reaches from a row below the navigation bar to the
  // row above the keyboard (or above the home indicator once the keyboard goes).
  const room = window.height - (insets.top + NAV + PEEK) - (keyboard > 0 ? keyboard + LIFT : rest);
  const expandedHeight = Math.max(room, 200);
  // While expanded, and until collapsing has finished, the Host keeps the
  // expanded height and the content is pinned to its foot. A Host fitted to
  // its content takes the new size at once, before SwiftUI has animated to
  // it, and UIKit centres the animating content in it: the group jumped up
  // as it grew, and swelled out of the Host as it shrank.
  // Collapsing is two springs: the capsule shrinks, then the operators come
  // back above it. The Host keeps its height through both, and lets go only
  // once nothing is moving, so its size and the content's agree.
  const [collapsing, setCollapsing] = useState<"shrinking" | "returning" | null>(null);
  // Noted in the same render that collapses, not in an effect after it: a
  // single render collapsed but not held lets the Host snap to the slim size.
  const [wasExpanded, setWasExpanded] = useState(false);
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded);
    setCollapsing(expanded ? null : "shrinking");
  }
  useEffect(() => {
    if (!collapsing) return;
    const t = setTimeout(() => setCollapsing(collapsing === "shrinking" ? "returning" : null), SPRING_MS + 80);
    return () => clearTimeout(t);
  }, [collapsing]);
  const lastTall = useRef(expandedHeight);
  if (expanded) lastTall.current = expandedHeight;
  // The content's height when last fitted, before it expanded: what it comes
  // back to. While the operators return, the Host is held at exactly that,
  // so letting go of it afterwards moves nothing.
  const slim = useRef(0);
  const held = expanded || collapsing === "shrinking" ? lastTall.current : collapsing === "returning" && slim.current > 0 ? slim.current : undefined;

  // The editor registers how to insert at its cursor and what's typed; chips, Save and the host app use it.
  const editor = useRef<EditorHandle | null>(null);
  useImperativeHandle(props.ref, () => ({ insert: (text, back) => editor.current?.insert(text, back) }), []);

  // Something above the capsule (operators, choices, a calendar): a soft
  // fade behind the group keeps it legible over the table, as a bar's
  // scroll edge does. Expanded, it veils the table behind the capsule.
  const raised = (state.kind === "editing" && !!state.chips?.length) || state.kind === "choosing" || state.kind === "dating" || expanded;
  const dark = useColorScheme() === "dark";
  const fade = expanded
    ? dark ? "linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.6) 12%, rgba(0,0,0,0.75))" : "linear-gradient(to bottom, rgba(242,242,247,0.35), rgba(242,242,247,0.6) 12%, rgba(242,242,247,0.8))"
    : dark ? "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.72) 38%, rgba(0,0,0,0.86))" : "linear-gradient(to bottom, rgba(242,242,247,0), rgba(242,242,247,0.78) 38%, rgba(242,242,247,0.9))";
  // Expanding, shrinking back and the operators' return after it each animate.
  // Letting go of the Host after the operators' return changes nothing on
  // screen, so it must not count as a change: another spring there dipped
  // the group behind the keyboard.
  const layout = layoutOf(state) + (expanded ? 100 : 0) + (collapsing === "shrinking" ? 200 : 0);
  const expansion: Expansion = { can: canExpand, on: expanded, height: expandedHeight, toggle: () => setExpanded((e) => !e), settling: collapsing === "shrinking" };
  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(e) => props.onHeight?.(e.nativeEvent.layout.height - rest)}
      style={[styles.dock, { paddingBottom: rest, transform: [{ translateY: lift }] }]}
    >
      {raised ? (
        <View
          pointerEvents="none"
          style={[styles.fade, { experimental_backgroundImage: fade }]}
        />
      ) : null}
      <Host
        matchContents={held === undefined ? { vertical: true } : undefined}
        onLayoutContent={(e) => { if (held === undefined) slim.current = e.nativeEvent.height; }}
        ignoreSafeArea="keyboard"
        style={[styles.host, held !== undefined && { height: held }]}
      >
        <Namespace id={ns}>
          <GlassEffectContainer
            spacing={2}
            modifiers={[
              padding({ horizontal: SIDE }),
              // The Host takes the content's height, so the content must not shrink
              // to fit the height it had before (a growing field would).
              fixedSize({ horizontal: false, vertical: true }),
              // Held at the expanded height (above), the content keeps to the foot.
              frame({ maxHeight: held === undefined ? undefined : Infinity, alignment: "bottom" }),
              animation(Animation.spring({ duration: SPRING_MS / 1000, bounce: 0.18 }), layout),
            ]}
          >
            <VStack alignment="leading" spacing={GAP}>
              <Chips {...props} ns={ns} editor={editor} expansion={expansion} />
              <HStack spacing={expanded ? 0 : GAP} alignment="bottom">
                <Lead {...props} ns={ns} expansion={expansion} />
                <Capsule {...props} ns={ns} editor={editor} expansion={expansion} />
                <Trail {...props} ns={ns} />
              </HStack>
            </VStack>
          </GlassEffectContainer>
        </Namespace>
      </Host>
    </Animated.View>
  );
}

/** The editor's handle inside the bar: also what's typed, for Save when it steps out of the capsule. */
type EditorHandle = GlassBarHandle & { value: () => string };
/** Whether the editor can expand, whether it is, and to what height. */
type Expansion = { can: boolean; on: boolean; height: number; toggle: () => void; settling?: boolean };
type Part = GlassBarProps & { ns: string; editor?: RefObject<EditorHandle | null>; expansion?: Expansion };

function Lead({ state, ns, onFilter, onDeselect, onCancel, expansion }: Part) {
  if (state.kind === "searching") return null; // absorbed into the search field
  // Expanded, ✕ is inside the capsule. This circle stays, shrunk to nothing
  // at the capsule's corner, so collapsing grows it back out of that corner:
  // a glass piece that appears afresh grows out of the whole capsule instead.
  const tucked = !!expansion?.on;
  const rest = state.kind === "rest";
  const action = rest ? onFilter : state.kind === "selected" ? onDeselect : onCancel;
  return (
    <Image
      systemName={rest ? "line.3.horizontal.decrease" : "xmark"}
      size={rest ? 19 : 17}
      onPress={action}
      modifiers={[
        frame({ width: tucked ? 0 : SIZE, height: tucked ? 0 : SIZE }),
        opacity(tucked ? 0 : 1),
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

function Chips({ state, ns, onChip, onChoose, onPickDate, onAddChoice, onClear, editor, expansion }: Part) {
  const dark = useColorScheme() === "dark";
  // Expanded, the operators are inside the capsule. Collapsing, they wait
  // until it's slim: a glass piece that appears grows out of its nearest
  // neighbour, and out of the tall capsule it swelled into an oval.
  if (expansion?.on || expansion?.settling) return null;
  const chips =
    state.kind === "editing" ? (state.chips ?? []).map((c) => ({ ...c, on: false, tone: undefined, press: () => { if (c.insert) editor?.current?.insert(c.insert, c.cursorBack); onChip?.(c.id); } }))
    : state.kind === "choosing"
      ? [
          // One choice can be none: first, as an empty option leads a menu.
          ...(state.canClear && !state.multiple
            ? [{ id: "\u0000none", label: "None", detail: undefined, symbol: undefined, on: !state.selected, tone: undefined, press: () => onClear?.() }]
            : []),
          ...state.choices.map((c) => ({
            ...c,
            detail: undefined,
            symbol: undefined,
            on: Array.isArray(state.selected) ? state.selected.includes(c.id) : c.id === state.selected,
            tone: c.colors ? (dark ? c.colors.dark : c.colors.light) : undefined,
            press: () => onChoose?.(c.id),
          })),
        ]
    : [];
  if (state.kind === "dating") return <DateCard state={state} ns={ns} onPickDate={onPickDate} onClear={onClear} />;
  if (chips.length === 0) return null;
  // Symbols share one glass background, as a toolbar group does: one
  // larger, steadier piece of glass reads better over a busy table than a
  // row of small ones.
  if (chips.every((c) => c.symbol)) return <SymbolGroup chips={chips} ns={ns} />;
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
          <HStack spacing={5}>
            {/* What's chosen carries a checkmark, as a menu's choice does. */}
            {c.on ? <Image systemName="checkmark" size={13} color={c.tone ? c.tone.fg : "white"} /> : null}
            <Text modifiers={[font({ size: c.detail ? 14 : 17, weight: c.detail || c.on ? "semibold" : "regular", design: c.detail ? "monospaced" : "default" }), lineLimit(1), fixedSize({ horizontal: true, vertical: false }), ...chipLabel(c)]}>
              {c.label}
            </Text>
          </HStack>
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

/** Symbols share one glass background, as a toolbar group does. */
function SymbolGroup({ chips, ns }: { chips: { id: string; label: string; symbol?: string; press: () => void }[]; ns: string }) {
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

/**
 * Along the foot of the expanded capsule: ✕, the operators (if any) and
 * Save, inside the glass rather than glass of their own, so the text gets
 * every point the capsule has. ✕'s circle and the operators' group melt
 * into the capsule as it grows, as More does when an edit begins.
 */
function CardActions({ state, editor, onCancel, onSave, onChip }: Pick<Part, "editor" | "onCancel" | "onSave" | "onChip"> & { state: GlassBarEditing }) {
  const chips = (state.chips ?? []).filter((c) => c.symbol);
  const blocked = !!state.error;
  return (
    <HStack spacing={0} alignment="center">
      <Image
        systemName="xmark"
        size={15}
        onPress={onCancel}
        modifiers={[frame({ width: 36, height: 36 }), background(PlatformColor("tertiarySystemFill"), shapes.circle()), contentShape(shapes.circle()), accessibilityLabel("Cancel")]}
      />
      <Spacer />
      {chips.map((c) => (
        <Image
          key={c.id}
          systemName={c.symbol as Symbol}
          size={18}
          onPress={() => { if (c.insert) editor?.current?.insert(c.insert, c.cursorBack); onChip?.(c.id); }}
          modifiers={[frame({ width: 46, height: 40 }), contentShape(shapes.rectangle()), accessibilityLabel(c.label)]}
        />
      ))}
      {chips.length ? <Spacer /> : null}
      <Image
        systemName="checkmark.circle.fill"
        size={34}
        color={blocked ? "#C7C7CC" : "#0A84FF"}
        onPress={blocked ? undefined : () => onSave?.(editor?.current?.value() ?? "")}
        modifiers={[accessibilityLabel("Save")]}
      />
    </HStack>
  );
}

function Capsule(props: Part) {
  const { state, ns, expansion } = props;
  const dark = useColorScheme() === "dark";
  const tall = !!expansion?.on;
  // contentShape: the whole capsule takes the tap, not only its text.
  // Expanded, its glass is frosted more heavily, to keep a page of text legible over the table.
  const shape = [
    frame({ maxWidth: Infinity, minHeight: SIZE, alignment: "leading" }),
    tall
      ? glassEffect({ glass: { variant: "regular", interactive: false, tint: dark ? "#1C1C1EB8" : "#FFFFFFB8" }, shape: "roundedRectangle", cornerRadius: 30 })
      : glass("roundedRectangle"),
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
        <HStack spacing={8} modifiers={[padding({ leading: 16, trailing: state.info ? 10 : 16, vertical: 6 }), ...shape, onTapGesture(() => props.onEdit?.()), accessibilityLabel(`${state.label}, ${state.value}. Edit`)]}>
          <VStack alignment="leading" spacing={1}>
            <Label text={state.label} size={11} />
            <Text modifiers={[font({ size: state.monospaced ? 14 : 16, design: state.monospaced ? "monospaced" : "default" }), lineLimit(1)]}>{state.value || " "}</Text>
            {/* The field's own help, as the web shows it on hover. */}
            {state.about ? <Text modifiers={[font({ size: 11 }), secondary, lineLimit(1)]}>{state.about}</Text> : null}
          </VStack>
          <Spacer />
          {state.info ? (
            <Image
              systemName="info.circle"
              size={19}
              onPress={() => props.onInfo?.()}
              modifiers={[frame({ width: 32, height: 32 }), secondary, contentShape(shapes.circle()), accessibilityLabel("About this field")]}
            />
          ) : null}
        </HStack>
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
  // Chosen: its colour in full; the rest only a light wash of it.
  if (c.tone) return c.tone.bg + (c.on ? "FF" : "4D");
  return c.on ? "#0A84FF" : undefined;
}
function chipLabel(c: ChipLook) {
  if (c.tone) return [foregroundStyle(c.tone.fg)];
  return c.on ? [foregroundStyle("white")] : [];
}

/** The system's calendar (and clock), in glass above the capsule; a pick saves. */
function DateCard({ state, ns, onPickDate, onClear }: { state: Extract<GlassBarState, { kind: "dating" }>; ns: string; onPickDate?: (d: Date) => void; onClear?: () => void }) {
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
      {/* Only when there's a date to clear: the calendar can't show "none". */}
      {state.canClear && state.value ? (
        <HStack modifiers={[padding({ horizontal: 8, bottom: 2 })]}>
          <Spacer />
          <Button label="Clear" role="destructive" onPress={() => onClear?.()} />
        </HStack>
      ) : null}
    </VStack>
  );
}

/** A label, its leading "ƒ " drawn as the system's function symbol. */
function Label({ text, size }: { text: string; size: number }) {
  if (!text.startsWith("ƒ ")) return <Text modifiers={[font({ size }), secondary, lineLimit(1), layoutPriority(1)]}>{text}</Text>;
  return (
    <HStack spacing={3} modifiers={[layoutPriority(1)]}>
      <Image systemName="function" size={size + 1} modifiers={[secondary]} />
      <Text modifiers={[font({ size }), secondary, lineLimit(1)]}>{text.slice(2)}</Text>
    </HStack>
  );
}

function Header({ label, detail, expansion }: { label: string; detail?: string; expansion?: Expansion }) {
  return (
    <HStack spacing={8}>
      <Label text={label} size={12} />
      <Spacer />
      {detail ? <Text modifiers={[font({ size: 12, weight: "semibold" }), lineLimit(1)]}>{detail}</Text> : null}
      {expansion?.can ? (
        <Image
          systemName={expansion.on ? "arrow.up.right.and.arrow.down.left" : "arrow.down.left.and.arrow.up.right"}
          size={12}
          onPress={expansion.toggle}
          modifiers={[
            frame({ width: 26, height: 26 }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
            background(PlatformColor("tertiarySystemFill"), shapes.circle()),
            contentShape(shapes.circle()),
            accessibilityLabel(expansion.on ? "Collapse" : "Expand"),
          ]}
        />
      ) : null}
    </HStack>
  );
}

/**
 * A formula's working, under the field in the expanded bar: what it read,
 * its result and what saving gives, as the web's formula panel lists them,
 * kept up to date as the formula is typed. Scrolls when there's more than
 * room for.
 */
function Working({ working, onFieldSettings }: { working: GlassBarWorking; onFieldSettings?: () => void }) {
  return (
    <ScrollView>
      <VStack alignment="leading" spacing={10} modifiers={[padding({ top: 4, trailing: 6 })]}>
        {working.sections.map((section, i) => (
          <VStack key={section.title ?? `section-${i}`} alignment="leading" spacing={4}>
            {section.title ? <Text modifiers={[font({ size: 11, weight: "semibold" }), secondary]}>{section.title.toUpperCase()}</Text> : null}
            {section.rows.map((row, j) => (
              <HStack key={`${row.label}-${j}`} spacing={8}>
                <Text modifiers={[font({ size: 14 }), row.strong ? foregroundStyle("primary") : secondary, lineLimit(1)]}>{row.label}</Text>
                <Spacer />
                <Text modifiers={[font({ size: 14, weight: row.strong ? "semibold" : "regular" }), lineLimit(1)]}>{row.value || "—"}</Text>
              </HStack>
            ))}
          </VStack>
        ))}
        {onFieldSettings ? (
          <Text modifiers={[font({ size: 14 }), foregroundStyle("#0A84FF"), onTapGesture(onFieldSettings), accessibilityLabel("Field Settings")]}>Field Settings…</Text>
        ) : null}
      </VStack>
    </ScrollView>
  );
}

/** Roughly one line of the editor's text, to fit as many as the expanded capsule holds. */
const LINE = { mono: 19, prose: 22 };
/** The expanded capsule's header, its actions along the foot, and padding. */
const EXPANDED_CHROME = 116;

function Editor({ state, shape, onChange, onSave, onSubmit, onFix, onCancel, onChip, onFieldSettings, editor, expansion }: Part & { state: GlassBarEditing; shape: ReturnType<typeof frame>[] }) {
  // Expo UI's TextField, or for a formula the bar's own coloured field: the same commands.
  const field = useRef<TextFieldRef>(null);
  const [spansFor, setSpansFor] = useState(state.initialValue);
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
      value: () => value.current,
      insert: (text, back = 0) => {
        const { start, end } = selection.current;
        const next = value.current.slice(0, start) + text + value.current.slice(end);
        const at = start + text.length - back;
        value.current = next;
        if (state.highlight) setSpansFor(next);
        selection.current = { start: at, end: at };
        void field.current?.setText(next).then(() => field.current?.setSelection(at, at));
        onChange?.(next);
      },
    };
    return () => { editor.current = null; };
  });
  // Text wraps and grows; a number or a date stays on one line.
  const grows = state.mode !== "line" || !!state.expandable;
  const mono = state.mode === "formula";
  const tall = !!expansion?.on;
  // The modifiers below keep one shape in both sizes, so SwiftUI keeps the
  // same field. Should it make a new one anyway, the new one starts from the
  // initial value: note what's typed and the cursor as the bar expands or
  // collapses, and put both back.
  const held = useRef({ text: value.current, ...selection.current });
  useMemo(() => { held.current = { text: value.current, ...selection.current }; }, [tall]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const { text, start, end } = held.current;
    const t = setTimeout(() => {
      value.current = text;
      selection.current = { start, end };
      void field.current?.setText(text).then(() => field.current?.setSelection(start, end));
      onChange?.(text);
    }, 80);
    return () => clearTimeout(t);
  }, [tall]);
  // Expanded: as many lines as fit, held open even when there are fewer; past that, the field scrolls.
  // Expanded with a formula's working under it, the field takes a few lines and the working the rest.
  const working = tall ? state.working : undefined;
  const lines = working ? 4 : tall ? Math.max(3, Math.floor((expansion!.height - EXPANDED_CHROME - (state.error ? 24 : 0)) / (mono ? LINE.mono : LINE.prose))) : 5;

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
    if (state.highlight) setSpansFor(next);
    onChange?.(next);
  };

  return (
    <VStack
      alignment="leading"
      spacing={tall ? 10 : 4}
      modifiers={[
        padding(tall ? { leading: 18, trailing: 12, top: 14, bottom: 12 } : { leading: 16, trailing: 6, top: 9, bottom: 6 }),
        frame({ height: tall ? expansion!.height : undefined, alignment: "topLeading" }),
        ...shape,
      ]}
    >
      <Header label={state.label} detail={state.detail} expansion={expansion} />
      <HStack spacing={8} alignment="bottom">
        {/* A currency's symbol, in the field's own type, as the web's cell shows it. */}
        {state.prefix ? (
          <Text modifiers={[font({ size: mono ? 15 : 17, design: mono ? "monospaced" : "default" }), secondary, padding({ vertical: 4 })]}>{state.prefix}</Text>
        ) : null}
        {state.highlight ? (
          <FormulaField
            key={state.editKey}
            ref={field}
            defaultValue={state.initialValue}
            autoFocus
            spans={state.highlight(spansFor)}
            spansFor={spansFor}
            fontSize={15}
            minLines={tall && !working ? lines : 1}
            maxLines={lines}
            onValueChange={change}
            onSelectionChange={(sel) => { selection.current = sel; }}
            onSubmit={(v) => onSubmit?.(v)}
            modifiers={[fixedSize({ horizontal: false, vertical: true }), padding({ vertical: 4 })]}
          />
        ) : (
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
              ...(grows ? [lineLimit(lines, { reservesSpace: tall && !working }), fixedSize({ horizontal: false, vertical: true })] : []),
              ...(state.keyboard && state.keyboard !== "default" ? [keyboardType(state.keyboard)] : []),
              // A number, code or formula: no word suggestions, corrections or capitals.
              ...(state.suggestions === false ? [autocorrectionDisabled(true), textInputAutocapitalization("never")] : []),
              // A one-line field reports Return as a submit, not a new line.
              ...(grows ? [] : [onSubmitModifier(() => onSubmit?.(value.current))]),
              padding({ vertical: 4 }),
            ]}
          />
        )}
        {/* Expanded, Save steps out to the row below. */}
        {tall ? null : (
          <Image
            systemName="checkmark.circle.fill"
            size={32}
            color={state.error ? "#C7C7CC" : "#0A84FF"}
            onPress={state.error ? undefined : () => onSave?.(value.current)}
            modifiers={[accessibilityLabel("Save")]}
          />
        )}
      </HStack>
      {state.error ? (
        <HStack spacing={10} modifiers={[padding({ bottom: 4 })]}>
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#D70015")]}>{state.error.message}</Text>
          {state.error.fixLabel ? (
            <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#D70015"), onTapGesture(() => onFix?.())]}>{state.error.fixLabel}</Text>
          ) : null}
        </HStack>
      ) : null}
      {working ? <Working working={working} onFieldSettings={onFieldSettings} /> : null}
      {tall ? <Spacer /> : null}
      {tall ? <CardActions state={state} editor={editor} onCancel={onCancel} onSave={onSave} onChip={onChip} /> : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  host: { width: "100%" },
  /** Behind the group, rising a little above it. */
  fade: { position: "absolute", left: 0, right: 0, top: -36, bottom: 0 },
});
