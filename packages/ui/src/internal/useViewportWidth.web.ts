/**
 * Web variant — Vite's resolve.extensions picks `.web.ts` ahead of `.ts`
 * so this file replaces the react-native-dependent default when bundling
 * for the browser. No react-native dependency reaches the web bundle.
 *
 * Returns `window.innerWidth` and subscribes to resize. SSR-safe: falls
 * back to a sensible default (1024) when `window` is undefined at module
 * load. Debouncing isn't needed at this scale — table-width math is one
 * Math.max per render.
 */
import { useEffect, useState } from "react";

const SSR_DEFAULT_WIDTH = 1024;

function readWidth(): number {
  if (typeof window === "undefined") return SSR_DEFAULT_WIDTH;
  return window.innerWidth;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return width;
}

/** A coarse pointer (a finger): a phone or tablet, laid out by its shorter side (useCompactViewport). */
function readCompactSide(): number {
  if (typeof window === "undefined") return SSR_DEFAULT_WIDTH;
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return touch ? Math.min(window.innerWidth, window.innerHeight) : window.innerWidth;
}

/**
 * Whether to lay out for a compact, touch screen: a window no wider than
 * `max`. In a phone's or tablet's browser it's the shorter side, which
 * turning it doesn't change, so a turn doesn't switch layouts (#610).
 * Elsewhere it's the window's width.
 */
export function useCompactViewport(max: number): boolean {
  return useCompactSide() <= max;
}

/** The window's width as a phone or tablet is laid out by: its shorter side (useCompactSide on native). */
export function useCompactSide(): number {
  const [side, setSide] = useState(readCompactSide);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setSide(readCompactSide());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return side;
}
