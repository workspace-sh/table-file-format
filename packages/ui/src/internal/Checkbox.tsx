/**
 * Native default — Metro picks this; Vite picks `Checkbox.web.tsx`.
 *
 * React Native has no checkbox (React Strict DOM's `input
 * type="checkbox"` throws there). This is a small square that fills
 * with a tick, like a desktop checkbox, rather than a Switch: a switch
 * is much wider, and table cells hold one in every row.
 *
 * With text beside it, box and text sit in a row and either toggles it,
 * as a web label does. (An html.label is a Text on native, which would
 * sit the box on the text's baseline.)
 */
import type { ComponentProps } from "react";
import { html, css } from "react-strict-dom";

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
    <html.button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={[styles.box, checked && styles.checked]}
    >
      <html.span style={styles.tick}>{checked ? "✓" : ""}</html.span>
    </html.button>
  );
  if (children === undefined) return box;
  return (
    <html.div style={[styles.row, style as never]}>
      {box}
      <html.span onClick={() => onChange(!checked)}>{children}</html.span>
    </html.div>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  },
  box: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    padding: 0,
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#aeaeb2",
      "@media (prefers-color-scheme: dark)": "#636366",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#2c2c2e",
    },
  },
  checked: {
    borderColor: {
      default: "#007aff",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    backgroundColor: {
      default: "#007aff",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  tick: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
});
