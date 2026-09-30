/**
 * macOS: a text input hears Escape as AppKit's cancelOperation:, which
 * react-native-macos (Fabric) reports as a key press of the escape
 * character, "\x1B", before it ends editing; React Strict DOM passes a
 * one-character key on to onKeyDown. So the input being typed in hears it.
 */
const ESCAPE = "\u001b";

export function useEscape(onEscape: () => void): { inputProps: Record<string, unknown> } {
  return {
    inputProps: {
      onKeyDown: (e: { key: string }) => {
        if (e.key === ESCAPE || e.key === "Escape") onEscape();
      },
    },
  };
}
