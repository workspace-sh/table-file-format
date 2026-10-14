/**
 * Web variant — Vite picks this. Metro picks `onWindowResize.ts`.
 *
 * Told when the window changes size. Returns the way to stop.
 */
export function onWindowResize(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}
