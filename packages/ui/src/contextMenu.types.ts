// The system's menus (UIMenu) as React Native shows them, through
// react-native-ios-context-menu: the props this library and the apps using
// it pass. The package is published without its types, so they're kept here
// once rather than in each app.
import type { ReactNode } from "react";

export interface ContextMenuItem {
  actionKey: string;
  actionTitle: string;
  menuAttributes?: "destructive"[];
  icon?: { type: "IMAGE_SYSTEM"; imageValue: { systemName: string } };
}

export interface ContextMenuConfig {
  menuTitle: string;
  menuItems: ContextMenuItem[];
}

export interface ContextMenuViewProps {
  menuConfig: ContextMenuConfig;
  previewConfig?: {
    previewType: "DEFAULT" | "CUSTOM";
    previewSize?: "INHERIT" | "STRETCH";
    borderRadius?: number;
  };
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  children?: ReactNode;
}

/** The same menu on a button: `isMenuPrimaryAction` opens it on a tap, not a hold. */
export interface ContextMenuButtonProps {
  menuConfig: ContextMenuConfig;
  isMenuPrimaryAction?: boolean;
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  children?: ReactNode;
}
