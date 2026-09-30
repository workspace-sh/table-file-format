// The system tooltip on a control that isn't text: a View carrying
// react-native-macos's `tooltip` (AppKit's toolTip). table-ui's Hinted is
// a span, which is a Text on native, and a button inside a Text lays out
// wrong, so the toolbar's buttons take their hints through this instead.
// Not collapsable: Fabric flattens a View whose only prop is `tooltip`.

import type { ComponentType, ReactNode } from "react";
import { View, type ViewProps } from "react-native";

const TooltipView = View as unknown as ComponentType<ViewProps & { tooltip?: string }>;

export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipView tooltip={text} collapsable={false}>
      {children}
    </TooltipView>
  );
}
