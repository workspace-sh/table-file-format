/**
 * Web variant — Vite picks this. Metro picks `Checkbox.tsx`.
 *
 * The browser's own checkbox. React Native has no checkbox, which is
 * why this forks.
 */
import type { ComponentProps } from "react";
import { html } from "react-strict-dom";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it's for, when no label beside it says so. */
  label?: string;
  /** Text beside the box, which toggles it too. */
  children?: string;
  /** The row holding the box and its text, when there is text. */
  style?: ComponentProps<typeof html.label>["style"];
}

export function Checkbox({ checked, onChange, label, children, style }: CheckboxProps) {
  const box = (
    <html.input
      dir="auto"
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e: { target: { checked: boolean } }) => onChange(e.target.checked)}
    />
  );
  if (children === undefined) return box;
  return (
    <html.label style={style}>
      {box}
      <html.span>{children}</html.span>
    </html.label>
  );
}
