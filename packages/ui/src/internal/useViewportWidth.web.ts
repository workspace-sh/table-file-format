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
