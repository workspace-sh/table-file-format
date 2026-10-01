// The page's side margin, for what scrolls sideways to run over it to the
// screen's edges (internal/Bleed). The web reads its CSS variable,
// `--page-gutter`; native has no such thing, so the app says it here.
import { createContext } from "react";

/** The page's side margin in points, on native. 0: nothing bleeds. */
export const PageGutter = createContext(0);
