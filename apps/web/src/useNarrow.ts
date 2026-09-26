import { useEffect, useState } from "react";

/** Phone-width and below: where the sidebar becomes a drawer (#86 step 7). */
export const NARROW_QUERY = "(max-width: 760px)";

export function useNarrow(): boolean {
  const query = () => typeof window !== "undefined" && window.matchMedia?.(NARROW_QUERY).matches === true;
  const [narrow, setNarrow] = useState(query);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW_QUERY);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
