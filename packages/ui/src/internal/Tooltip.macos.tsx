/**
 * macOS: AppKit's own tooltip (NSView toolTip) on hover, through
 * react-native-macos's `tooltip` View prop. React Strict DOM passes only
 * the props it knows to native views, so the tooltip needs a View of its
 * own: unstyled, so it sizes to what it wraps and adds no space. (What it
 * wraps can land half a point lower, rounding inside its own frame.)
 */
import type { ComponentType, ReactNode } from "react";
import { View, type ViewProps } from "react-native";

const TooltipView = View as unknown as ComponentType<ViewProps & { tooltip?: string }>;

export function Tooltip({ text, children }: { text?: string; children: ReactNode }) {
  if (!text) return children;
  return (
    // Not collapsable: Fabric flattens a View whose only prop is `tooltip`
    // (it isn't among the props that keep a view), and the tooltip with it.
    <TooltipView tooltip={text} collapsable={false}>
      {children}
    </TooltipView>
  );
}
