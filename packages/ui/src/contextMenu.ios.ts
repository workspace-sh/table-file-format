// The system's menus on iOS (contextMenu.types.ts).
import type { ComponentType } from "react";
// @ts-expect-error -- react-native-ios-context-menu 3.2.1 is published without its built lib/ or types; Metro runs its src/
import { ContextMenuButton as UntypedContextMenuButton, ContextMenuView as UntypedContextMenuView } from "react-native-ios-context-menu";
import type { ContextMenuButtonProps, ContextMenuViewProps } from "./contextMenu.types";

export type { ContextMenuButtonProps, ContextMenuConfig, ContextMenuItem, ContextMenuViewHandle, ContextMenuViewProps } from "./contextMenu.types";

/** A hold on its children shows the menu (UIContextMenuInteraction). */
export const ContextMenuView = UntypedContextMenuView as ComponentType<ContextMenuViewProps>;
/** A button whose menu opens on a hold, or on a tap with `isMenuPrimaryAction`. */
export const ContextMenuButton = UntypedContextMenuButton as ComponentType<ContextMenuButtonProps>;
