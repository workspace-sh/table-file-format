/**
 * Native default — Metro picks this; Vite picks `Checkbox.web.tsx`.
 *
 * React Native has no checkbox (React Strict DOM's `input
 * type="checkbox"` throws there). This is a small square that fills
 * with a tick, like a desktop checkbox, rather than a Switch: a switch
 * is much wider, and table cells hold one in every row.
 */
import { html, css } from "react-strict-dom";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it's for, when no label beside it says so. */
  label?: string;
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
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
}

const styles = css.create({
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
