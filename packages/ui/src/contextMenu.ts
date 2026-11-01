// Elsewhere than iOS there's no system menu to show: the children alone
// (contextMenu.ios.ts has the real ones).
import type { ComponentType } from "react";
import type { ContextMenuButtonProps, ContextMenuViewProps } from "./contextMenu.types";

export type { ContextMenuButtonProps, ContextMenuConfig, ContextMenuItem, ContextMenuViewHandle, ContextMenuViewProps } from "./contextMenu.types";

export const ContextMenuView: ComponentType<ContextMenuViewProps> = ({ children }) => children ?? null;
export const ContextMenuButton: ComponentType<ContextMenuButtonProps> = ({ children }) => children ?? null;
