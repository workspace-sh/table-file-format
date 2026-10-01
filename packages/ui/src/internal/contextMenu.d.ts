// PROTOTYPE (#300): react-native-ios-context-menu 3.2.1 is published
// without its built lib/ (types included), only src/, which Metro runs.
declare module "react-native-ios-context-menu" {
  import type { ComponentType, ReactNode } from "react";
  export const ContextMenuView: ComponentType<{
    menuConfig: { menuTitle: string; menuItems: object[] };
    onPressMenuItem?: (e: { nativeEvent: { actionKey: string } }) => void;
    children?: ReactNode;
  }>;
}
