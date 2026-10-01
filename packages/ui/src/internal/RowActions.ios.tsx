/**
 * PROTOTYPE (#300): touch and hold a row for the system's context menu,
 * UIKit's UIContextMenuInteraction on the row's own React Native view
 * (react-native-ios-context-menu): the row lifts, with the system's
 * haptic, and the menu opens; Delete in red. Nothing is hosted in SwiftUI.
 */
import type { ReactElement } from "react";
import { ContextMenuView } from "react-native-ios-context-menu";
import type { RowActionsProps } from "../controlSlots";

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  if (actions.length === 0) return children;
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
      onPressMenuItem={({ nativeEvent }) => actions.find((a) => a.id === nativeEvent.actionKey)?.onSelect()}
    >
      {children}
    </ContextMenuView>
  );
}

RowActions.gesture = "Touch and hold a row";
