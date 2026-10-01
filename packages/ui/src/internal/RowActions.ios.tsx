/**
 * iOS default: touch and hold a row for the system's context menu,
 * UIKit's UIContextMenuInteraction on the row's own React Native view
 * (react-native-ios-context-menu): the row lifts with the system's
 * haptic, and the menu opens with each action's SF Symbol, Delete in
 * red. Nothing is hosted in SwiftUI (hosted rows lost their text, #292).
 *
 * The lift is a card with the row's title, as Mail and Notes lift what's
 * visible: the row itself runs wider than the screen, and lifted whole it
 * would be shrunk to fit, off-screen columns and all.
 */
import type { ComponentType, ReactElement, ReactNode } from "react";
import { PlatformColor, Text, View } from "react-native";
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
  previewConfig?: { previewType: "DEFAULT" | "CUSTOM"; previewSize?: "INHERIT" | "STRETCH" };
  renderPreview?: () => ReactNode;
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  children?: ReactNode;
}

const ContextMenuView = UntypedContextMenuView as ComponentType<ContextMenuViewProps>;

export function RowActions({ actions, children, title }: RowActionsProps): ReactElement {
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
      {...(title
        ? {
            previewConfig: { previewType: "CUSTOM" as const, previewSize: "INHERIT" as const },
            renderPreview: () => (
              <View style={{ paddingHorizontal: 20, paddingVertical: 16, minWidth: 220, maxWidth: 340, backgroundColor: PlatformColor("systemBackground") }}>
                <Text numberOfLines={3} style={{ fontSize: 17, fontWeight: "600", color: PlatformColor("label") }}>
                  {title}
                </Text>
              </View>
            ),
          }
        : {})}
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
