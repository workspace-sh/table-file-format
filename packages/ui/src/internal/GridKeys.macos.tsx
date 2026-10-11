/**
 * macOS: the table's keys. React Strict DOM sends key presses only from
 * text fields on native, and a click gives the keyboard only to the very
 * view clicked, so here a view around the table takes the keyboard when a
 * cell is selected (`focus()`) and hands on the keys pressed while it has
 * it: arrows, Return and typing then work as they do in a browser.
 */
import { forwardRef, useImperativeHandle, useRef, type ComponentType, type ReactNode } from "react";
import { View } from "react-native";
import type { GridKeysHandle, GridKeysProps } from "./GridKeys";

export type { GridKeysHandle, GridKeysProps } from "./GridKeys";

interface HandledKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

interface MacKeyEvent {
  nativeEvent: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
  target: unknown;
  currentTarget: unknown;
}

// react-native-macos's View takes these; React Native's own types don't have them.
const KeyView = View as unknown as ComponentType<{
  ref?: unknown;
  focusable?: boolean;
  enableFocusRing?: boolean;
  keyDownEvents?: HandledKey[];
  onKeyDown?: (e: MacKeyEvent) => void;
  style?: object;
  children?: ReactNode;
}>;

// The keys the table acts on, which then go no further: left to the
// system, an arrow would scroll the page and a letter would beep. A key
// held with Command or Control is the menus'.
const NAMED = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab", "Enter", "F2", "Escape", "Backspace", "Delete"];
const TYPED = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
const HANDLED: HandledKey[] = [...NAMED.map((key) => ({ key })), ...TYPED.map((key) => ({ key, metaKey: false, ctrlKey: false }))];

export const GridKeys = forwardRef<GridKeysHandle, GridKeysProps>(function GridKeys({ onKeyDown, children }, ref) {
  const view = useRef<{ focus?: () => void } | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus?.() }));
  return (
    <KeyView
      ref={view}
      focusable
      // The selected cell shows where the keyboard is; no ring round it all.
      enableFocusRing={false}
      keyDownEvents={HANDLED}
      onKeyDown={(e) => {
        // A key pressed in a cell's editor comes up through here too: it's the editor's.
        if (e.target !== e.currentTarget) return;
        const { key, shiftKey, metaKey, ctrlKey, altKey } = e.nativeEvent;
        onKeyDown({ key, shiftKey, metaKey, ctrlKey, altKey });
      }}
      style={SHRINK}
    >
      {children}
    </KeyView>
  );
});

// As wide as the table in it, so it sits in a row (edge to edge) as the table did.
const SHRINK = { flexShrink: 0 };
