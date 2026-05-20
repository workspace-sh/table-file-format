/**
 * Cross-platform focus state. Replaces the CSS `:focus-within`
 * pseudo-class (which RSD warns about on native: `unsupported style
 * property ":focus-within"`) with explicit React state driven by the
 * standard `onFocus` / `onBlur` events that RSD passes through on
 * both web and native.
 *
 * Usage:
 *
 *   const { isFocused, focusProps } = useFocused();
 *   return (
 *     <html.input
 *       {...focusProps}
 *       style={isFocused ? styles.inputFocused : styles.input}
 *     />
 *   );
 *
 * To replicate `:focus-within` behaviour (the *parent* styled when
 * any descendant has focus), the parent reads `isFocused` from the
 * child via state lift or prop callback. There's no platform-side
 * equivalent of `:focus-within` on RN — explicit state propagation
 * is the only path.
 *
 * No `.web.ts` variant needed: the implementation is pure React
 * state + handlers; both platforms wire onFocus/onBlur identically.
 */
import { useCallback, useState } from "react";

export interface UseFocusedReturn {
  isFocused: boolean;
  focusProps: {
    onFocus: () => void;
    onBlur: () => void;
  };
}

export function useFocused(): UseFocusedReturn {
  const [isFocused, setIsFocused] = useState(false);
  const onFocus = useCallback(() => setIsFocused(true), []);
  const onBlur = useCallback(() => setIsFocused(false), []);
  return { isFocused, focusProps: { onFocus, onBlur } };
}
