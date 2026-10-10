// What a floating panel (a row's page on the web and macOS) is drawn on.
// Absent, its own fill and border. A host can give it a native material,
// as the macOS app gives Liquid Glass: the component fills the panel and
// holds its content, and the panel leaves off its own fill. It holds the
// content, not sits behind it, because a native material decides what is
// drawn above it: AppKit keeps only a glass view's own content over the glass.
import { createContext, type ComponentType, type ReactNode } from "react";

/**
 * Fills a panel and holds its content, laid out as a column as the panel
 * lays it out. `radius`: the panel's corners.
 */
export type PanelSurfaceComponent = ComponentType<{ radius: number; children: ReactNode }>;

export const PanelSurface = createContext<PanelSurfaceComponent | null>(null);
