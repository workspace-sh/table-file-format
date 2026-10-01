/**
 * Web variant — Vite picks this. Metro picks `Select.tsx`.
 *
 * The browser's own select: its look, keyboard and accessibility are
 * what people expect on the web, so nothing here replaces them. React
 * Native has no select at all, which is why this forks.
 */
import type { SelectHandle, SelectProps } from "../controlSlots";
import { forwardRef } from "react";
import { html } from "react-strict-dom";

export type { SelectHandle, SelectOption, SelectProps } from "../controlSlots";

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={style as any}
    >
      {options.map((o) => (
        <html.option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </html.option>
      ))}
    </html.select>
  );
});
