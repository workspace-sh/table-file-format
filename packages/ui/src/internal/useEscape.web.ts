/**
 * Web: Escape anywhere on the page, heard on the document. Adds nothing to
 * the input, so the markup is as it was.
 */
import { useEffect } from "react";

export function useEscape(onEscape: () => void): { inputProps: Record<string, unknown> } {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEscape]);
  return { inputProps: {} };
}
