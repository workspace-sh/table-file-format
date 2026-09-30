/**
 * Web variant — Vite picks this. Metro picks `Select.tsx`.
 *
 * The browser's own select: its look, keyboard and accessibility are
 * what people expect on the web, so nothing here replaces them. React
 * Native has no select at all, which is why this forks.
 */
import { forwardRef } from "react";
import type { ComponentProps } from "react";
import { html } from "react-strict-dom";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  style?: ComponentProps<typeof html.select>["style"];
  /** For assistive technology, when nothing beside it names it. */
  label?: string;
  /** Keys pressed while the select (or, on native, its menu) has focus. */
  onKeyDown?: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
  /** Left without choosing: focus moved away, or the menu was dismissed. */
  onBlur?: () => void;
}

/** What a ref to a Select can do on every platform: take focus (native opens its menu). */
export interface SelectHandle {
  focus: () => void;
}

export const Select = forwardRef<SelectHandle, SelectProps>(function Select(
  { value, options, onChange, style, onKeyDown, onBlur, label },
  ref,
) {
  return (
    <html.select
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      aria-label={label}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      style={style}
    >
      {options.map((o) => (
        <html.option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </html.option>
      ))}
    </html.select>
  );
});
