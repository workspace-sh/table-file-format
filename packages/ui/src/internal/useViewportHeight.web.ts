/**
 * Web variant — the twin of useViewportWidth.web.ts: `window.innerHeight`,
 * following resizes. Used to open a popover upwards when there isn't room
 * for it below its trigger.
 */
import { useEffect, useState } from "react";

const SSR_DEFAULT_HEIGHT = 768;

function readHeight(): number {
  if (typeof window === "undefined") return SSR_DEFAULT_HEIGHT;
  return window.innerHeight;
}

export function useViewportHeight(): number {
  const [height, setHeight] = useState(readHeight);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setHeight(window.innerHeight);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return height;
}
