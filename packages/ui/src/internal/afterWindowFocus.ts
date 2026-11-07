// Run something once the screen's window has the focus back from a window
// over it (a menu, a sheet): Android shows no keyboard for a field focused in
// a window without focus. Elsewhere it runs at once.

import { AppState } from "react-native";

import { PLATFORM_OS } from "./platformOS";

/** `run` once the app's window has the focus again, or after `wait` ms when nothing took it. */
export function afterWindowFocus(run: () => void, wait = 400): void {
  if (PLATFORM_OS !== "android") {
    run();
    return;
  }
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    sub.remove();
    clearTimeout(fallback);
    requestAnimationFrame(run);
  };
  const sub = AppState.addEventListener("focus", go);
  const fallback = setTimeout(go, wait);
}
