/** A failed formula's mark (#685) on the web: its kind's Lucide icon, in the text's colour. */
import { ERROR_MARKS, type FormulaErrorGroup } from "../display";

export function ErrorMark({ group }: { group: FormulaErrorGroup }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, marginInlineEnd: 4, verticalAlign: "-2px" }}
    >
      {ERROR_MARKS[group].paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
