/**
 * iOS: a formula field whose references, functions, strings and numbers are
 * coloured as they are typed. Expo UI's TextField takes plain text only, so
 * this is the package's own SwiftUI view (ios/FormulaFieldView.swift),
 * registered as an Expo UI view: it sits in the bar's Host and takes the same
 * modifiers. The host app says where the colours go (`highlight`), so the bar
 * stays free of any one formula language and the rules live once, in shared
 * code. The native field keeps the last colouring in step with each edit
 * until the colouring for the new text arrives, so colour never drops out.
 */
import { requireNativeView } from "expo";
import type { Ref } from "react";
import type { TextFieldRef } from "@expo/ui/swift-ui";
import { createViewModifierEventListener, type ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import type { GlassBarSpan } from "./types";

/** The same commands as Expo UI's TextField, so the bar drives either. */
export type FormulaFieldRef = TextFieldRef;

type Props = {
  ref?: Ref<FormulaFieldRef>;
  defaultValue: string;
  autoFocus?: boolean;
  /** The colouring, and the text it was worked out for: spans for older text are ignored. */
  spans: GlassBarSpan[];
  spansFor: string;
  fontSize?: number;
  minLines?: number;
  maxLines?: number;
  onValueChange?: (value: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onSubmit?: (value: string) => void;
  modifiers?: ModifierConfig[];
};

type NativeEvent<T> = { nativeEvent: T };
type NativeProps = Omit<Props, "onValueChange" | "onSelectionChange" | "onSubmit"> & {
  onValueChange?: (e: NativeEvent<{ value: string }>) => void;
  onSelectionChange?: (e: NativeEvent<{ start: number; end: number }>) => void;
  onSubmit?: (e: NativeEvent<{ value: string }>) => void;
};

const Native: React.ComponentType<NativeProps> = requireNativeView("GlassBar", "FormulaFieldView");

export function FormulaField({ modifiers, onValueChange, onSelectionChange, onSubmit, ...rest }: Props) {
  return (
    <Native
      {...rest}
      modifiers={modifiers}
      {...(modifiers ? createViewModifierEventListener(modifiers) : undefined)}
      onValueChange={onValueChange ? (e) => onValueChange(e.nativeEvent.value) : undefined}
      onSelectionChange={onSelectionChange ? (e) => onSelectionChange({ start: e.nativeEvent.start, end: e.nativeEvent.end }) : undefined}
      onSubmit={onSubmit ? (e) => onSubmit(e.nativeEvent.value) : undefined}
    />
  );
}
