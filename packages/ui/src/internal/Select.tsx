/**
 * Native default — Metro picks this; Vite picks `Select.web.tsx`.
 *
 * React Native has no select, and React Strict DOM's `html.select`
 * renders an empty box there. So a native select is a button showing
 * the chosen label, which opens a menu of the options in the app's
 * `Portal`. The chosen option is ticked, a disabled one can't be
 * picked, and a click outside or Escape closes it.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { measureAnchor, type AnchorRect } from "./measureAnchor";
import { Portal } from "./Portal";
import { useViewportHeight } from "./useViewportHeight";
import { useViewportWidth } from "./useViewportWidth";

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
  /** Keys pressed while the select (or, on native, its menu) has focus. */
  onKeyDown?: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
  /** Left without choosing: focus moved away, or the menu was dismissed. */
  onBlur?: () => void;
}

/** What a ref to a Select can do on every platform: take focus (native opens its menu). */
export interface SelectHandle {
  focus: () => void;
}

// One menu line: 13px text plus 6px above and below.
const ITEM_HEIGHT = 28;
const MENU_PADDING = 4;
const MENU_MAX = 320;
const GAP = 4;
const EDGE = 8;

export const Select = forwardRef<SelectHandle, SelectProps>(function Select(
  { value, options, onChange, style, onKeyDown, onBlur },
  ref,
) {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchor = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const optionRefs = useRef<any[]>([]);
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();

  const open = async () => {
    setRect(await measureAnchor(anchor.current));
  };
  useImperativeHandle(ref, () => ({ focus: () => void open() }));

  const close = () => setRect(null);
  const choose = (next: string) => {
    close();
    onChange(next);
  };
  const dismiss = () => {
    close();
    onBlur?.();
  };
  const onMenuKey = (e: { key: string; shiftKey?: boolean; target?: unknown; preventDefault?: () => void }) => {
    const at = optionRefs.current.findIndex((el) => el === e.target);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault?.();
      const next = Math.max(0, Math.min(options.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
      optionRefs.current[next]?.focus?.();
    } else if (e.key === "Escape" || e.key === "Tab") {
      close();
      if (onKeyDown) onKeyDown(e);
      else onBlur?.();
    }
  };

  const chosen = options.find((o) => o.value === value);
  const height = Math.min(options.length * ITEM_HEIGHT + MENU_PADDING * 2, MENU_MAX, viewportHeight - EDGE * 2);
  const width = Math.max(rect?.width ?? 0, 180);
  const below = (rect?.top ?? 0) + (rect?.height ?? 0) + GAP;
  const top = Math.max(EDGE, Math.min(below, viewportHeight - height - EDGE));
  const left = Math.max(EDGE, Math.min(rect?.left ?? 0, viewportWidth - width - EDGE));

  return (
    <>
      <html.button
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          anchor.current = el;
        }}
        aria-haspopup="listbox"
        aria-expanded={rect !== null}
          onClick={() => void open()}
        style={[styles.button, style as never]}
      >
        <html.span style={styles.buttonLabel}>
          {chosen?.label ?? ""}
        </html.span>
        <html.span style={styles.chevron}>▾</html.span>
      </html.button>
      {rect && (
        <Portal>
          <html.div style={styles.backdrop} onClick={dismiss} />
          <html.div role="listbox" onKeyDown={onMenuKey} style={[styles.menu, styles.menuAt(top, left, width, height)]}>
            <ScrollView>
              {options.map((o, i) => (
                <html.button
                  key={o.value}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ref={(el: any) => {
                    optionRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  onClick={() => choose(o.value)}
                  style={[styles.item, o.disabled && styles.itemDisabled]}
                >
                  <html.span style={styles.tick}>{o.value === value ? "✓" : ""}</html.span>
                  <html.span style={[styles.itemLabel, o.disabled && styles.itemLabelDisabled]}>
                    {o.label}
                  </html.span>
                </html.button>
              ))}
            </ScrollView>
          </html.div>
        </Portal>
      )}
    </>
  );
});

const styles = css.create({
  button: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    textAlign: "start",
  },
  buttonLabel: {
    flex: 1,
    fontSize: 13,
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  chevron: {
    fontSize: 10,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  menu: {
    position: "absolute",
    paddingBlock: MENU_PADDING,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    borderColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2c2c31" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1f" },
  },
  menuAt: (top: number, left: number, width: number, height: number) => ({ top, left, width, height }),
  item: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: ITEM_HEIGHT,
    paddingInline: 8,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#2a2a2e" },
    },
  },
  itemDisabled: {
    cursor: "default",
    backgroundColor: "transparent",
  },
  tick: {
    width: 14,
    fontSize: 12,
    color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
  itemLabel: {
    flex: 1,
    fontSize: 13,
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  itemLabelDisabled: {
    color: { default: "#aeaeb2", "@media (prefers-color-scheme: dark)": "#636366" },
  },
});
