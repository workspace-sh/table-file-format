/**
 * Escape, as a way out (closing an editor that has nothing unsaved). Here
 * (iOS, Android) there's no Escape key to listen for, so it adds nothing.
 * The web listens on the document (useEscape.web.ts); macOS hears it from
 * the text input being typed in (useEscape.macos.ts). Spread `inputProps`
 * onto that input: only macOS fills it.
 */
export function useEscape(_onEscape: () => void): { inputProps: Record<string, unknown> } {
  return { inputProps: {} };
}
