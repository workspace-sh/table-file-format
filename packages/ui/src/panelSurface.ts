// What a floating panel (a row's page on the web and macOS) is drawn on.
// Absent, its own fill and border. A host can give it a native material,
// as the macOS app gives Liquid Glass: the component is drawn first inside
// the panel, filling it, and the panel leaves off its own fill.
import { createContext, type ComponentType } from "react";

/** Fills a panel, behind its content. `radius`: the panel's corners. */
export type PanelSurfaceComponent = ComponentType<{ radius: number }>;

export const PanelSurface = createContext<PanelSurfaceComponent | null>(null);
