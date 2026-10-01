/**
 * iOS default: touch and hold a row for the system's context menu,
 * UIKit's UIContextMenuInteraction on the row's own React Native view
 * (react-native-ios-context-menu): the row lifts with the system's
 * haptic, and the menu opens with each action's SF Symbol, Delete in
 * red. Nothing is hosted in SwiftUI (hosted rows lost their text, #292).
 *
 * The lift is the row as it is on screen. A table's row runs wider than
 * the screen, and lifted whole it would be shrunk to fit, off-screen
 * columns and all, so only the part in view lifts (the clip is native: the
 * package's preview parameters, patched in patches/).
 */
import type { ComponentType, ReactElement, ReactNode } from "react";
import { View } from "react-native";
// react-native-ios-context-menu 3.2.1 is published without its built lib/,
// types included: Metro runs its src/, and its props are typed here, for
// this file only.
// @ts-expect-error -- no type declarations in the published package
import { ContextMenuView as UntypedContextMenuView } from "react-native-ios-context-menu";
import type { RowActionsProps } from "../controlSlots";

interface ContextMenuViewProps {
  menuConfig: {
    menuTitle: string;
    menuItems: {
      actionKey: string;
      actionTitle: string;
      menuAttributes?: "destructive"[];
      icon?: { type: "IMAGE_SYSTEM"; imageValue: { systemName: string } };
    }[];
  };
  previewConfig?: {
    previewType: "DEFAULT" | "CUSTOM";
    previewSize?: "INHERIT" | "STRETCH";
    borderRadius?: number;
  };
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  children?: ReactNode;
}

const ContextMenuView = UntypedContextMenuView as ComponentType<ContextMenuViewProps>;

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  if (actions.length === 0) return children;
  const run = (id: string) => actions.find((action) => action.id === id)?.onSelect();
  return (
    <ContextMenuView
      menuConfig={{
        menuTitle: "",
        menuItems: actions.map((action) => ({
          actionKey: action.id,
          actionTitle: action.label,
          ...(action.destructive ? { menuAttributes: ["destructive" as const] } : {}),
          ...(action.symbol?.sf ? { icon: { type: "IMAGE_SYSTEM" as const, imageValue: { systemName: action.symbol.sf } } } : {}),
        })),
      }}
      // The row lifts as it is on screen, as the system lifts what's
      // touched: only the part in view, not the columns scrolled off.
      // Rows have no fill of their own (the page shows through): the lift
      // is on the page's, systemBackground (the patch, as the clip).
      previewConfig={{ previewType: "DEFAULT", borderRadius: 12 }}
      onPressMenuItem={({ nativeEvent }) => run(nativeEvent.actionKey)}
    >
      {/* The same actions for VoiceOver, which doesn't touch and hold: the row's custom actions. */}
      <View
        accessibilityActions={actions.map((action) => ({ name: action.id, label: action.label }))}
        onAccessibilityAction={(e) => run(e.nativeEvent.actionName)}
      >
        {children}
      </View>
    </ContextMenuView>
  );
}

RowActions.gesture = "Touch and hold a row";
