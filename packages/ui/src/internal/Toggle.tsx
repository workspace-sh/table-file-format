/**
 * Default (web, macOS): a checkbox for a setting and a cell alike, the
 * browser's own on the web (Checkbox.web.tsx), a small ticked square on
 * macOS (Checkbox.tsx). iOS and Android have `Toggle.ios.tsx` and
 * `Toggle.android.tsx`.
 */
import type { ReactElement } from "react";
import type { ToggleProps } from "../controlSlots";
import { Checkbox } from "./Checkbox";

export function Toggle({ checked, onChange, label, children, style }: ToggleProps): ReactElement {
  return (
    <Checkbox checked={checked} onChange={onChange} label={label} style={style as never}>
      {children}
    </Checkbox>
  );
}
