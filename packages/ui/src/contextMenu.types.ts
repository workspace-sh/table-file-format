// The system's menus (UIMenu) as React Native shows them, through
// react-native-ios-context-menu: the props this library and the apps using
// it pass. The package is published without its types, so they're kept here
// once rather than in each app.
import type { ReactNode, Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

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

/** What a ContextMenuView's `ref` can do: open its menu from code, as a hold does. */
export interface ContextMenuViewHandle {
  presentMenu(): Promise<void>;
}

export interface ContextMenuViewProps {
  menuConfig: ContextMenuConfig;
  previewConfig?: {
    previewType: "DEFAULT" | "CUSTOM";
    previewSize?: "INHERIT" | "STRETCH";
    borderRadius?: number;
    backgroundColor?: string;
  };
  /**
   * The lifted preview, with `previewType: "CUSTOM"`, in place of the view
   * itself: something drawn elsewhere (a canvas's card) lifted from where
   * the view sits.
   */
  renderPreview?: () => ReactNode;
  /** The preview is mounted from the start rather than on the hold (`false`): ready to show when the menu opens from code. */
  lazyPreview?: boolean;
  /** Whether a hold on the view opens the menu; `presentMenu` still does. */
  isContextMenuEnabled?: boolean;
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  /** The native view is ready: `presentMenu` does nothing before this. */
  onDidSetViewID?: () => void;
  /** The menu has gone, whether an action was chosen or not. */
  onMenuDidHide?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ContextMenuViewHandle>;
  children?: ReactNode;
}

/** The same menu on a button: `isMenuPrimaryAction` opens it on a tap, not a hold. */
export interface ContextMenuButtonProps {
  menuConfig: ContextMenuConfig;
  isMenuPrimaryAction?: boolean;
  onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
  children?: ReactNode;
}
