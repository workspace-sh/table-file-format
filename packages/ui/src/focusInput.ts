import { PLATFORM_OS } from "./internal/platformOS";

/**
 * Focus a text input. On native, react-strict-dom's ref for an input is a
 * copy of the native element, and focus() called on the copy does
 * nothing: an editor opens that looks like the cell and takes no typing
 * (#281). React Native's TextInput puts getNativeRef() on it, which gives
 * the element itself, so that's what's focused there. A web input has no
 * getNativeRef, so this is its own focus().
 *
 * Android shows the keyboard only for a field already in the window: an
 * editor focused as it mounts (a cell opening to edit) took the focus with
 * the keyboard left down, and a second tap was needed. There the focus
 * waits a frame.
 */
export function focusInput(el: unknown): void {
  const input = el as { focus?: () => void; getNativeRef?: () => { focus?: () => void } | null } | null;
  const native = typeof input?.getNativeRef === "function" ? input.getNativeRef() : null;
  const target = native ?? input;
  if (typeof target?.focus !== "function") return;
  if (PLATFORM_OS === "android") requestAnimationFrame(() => target.focus?.());
  else target.focus();
}
