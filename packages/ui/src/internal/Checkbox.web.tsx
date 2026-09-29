/**
 * Web variant — Vite picks this. Metro picks `Checkbox.tsx`.
 *
 * The browser's own checkbox. React Native has no checkbox, which is
 * why this forks.
 */
import { html } from "react-strict-dom";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it's for, when no label beside it says so. */
  label?: string;
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <html.input
      dir="auto"
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e: { target: { checked: boolean } }) => onChange(e.target.checked)}
    />
  );
}
