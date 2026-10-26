/**
 * A failed formula's mark (#685), before its words. Here (macOS, Android)
 * a character standing for its kind, until the platform draws the
 * symbol: the web draws Lucide's (ErrorMark.web.tsx), iOS the SF Symbol
 * (ErrorMark.ios.tsx).
 */
import { html } from "react-strict-dom";
import type { FormulaErrorGroup } from "../display";

const MARKS: Record<FormulaErrorGroup, string> = { loop: "↻", missing: "?", mismatch: "≠", calculation: "⚠︎" };

export function ErrorMark({ group }: { group: FormulaErrorGroup }) {
  return <html.span aria-hidden>{`${MARKS[group]} `}</html.span>;
}
