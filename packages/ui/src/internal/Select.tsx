/**
 * Native default — Metro picks this; Vite picks `Select.web.tsx`.
 *
 * React Native has no select, and React Strict DOM's `html.select`
 * renders an empty box there. So a native select is a button showing
 * the chosen label, which opens a menu of the options in the app's
 * `Portal`. The chosen option is ticked, a disabled one can't be
 * picked, and a click outside or Escape closes it.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { measureAnchor, type AnchorRect } from "./measureAnchor";
import { Portal } from "./Portal";
import { ITEM_HEIGHT, placeMenu } from "./selectMenu";

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
  const [rect, setRect] = useState<AnchorRect | null>(null);
  // The space overlays have, measured from the backdrop that fills it once
  // the menu opens. (useWindowDimensions is the screen, not the window, on
  // macOS.) The menu waits for it, so it's placed once, in the right place.
  const [bounds, setBounds] = useState<AnchorRect | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchor = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const optionRefs = useRef<any[]>([]);
  const scroller = useRef<ScrollView>(null);

  const open = async () => {
    setRect(await measureAnchor(anchor.current));
  };
  useImperativeHandle(ref, () => ({ focus: () => void open() }));

  const close = () => {
    setRect(null);
    setBounds(null);
  };
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
  const { top, left, width, height } = placeMenu(
    rect ?? { top: 0, left: 0, width: 0, height: 0 },
    options.map((o) => o.label),
    bounds ?? { width: 0, height: 0 },
  );

  // Opened: the chosen option is in view, near the middle of a long list,
  // and has focus, so arrows and Enter work at once.
  useEffect(() => {
    if (!bounds) return;
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    // After the list's first layout, or the scroll is ignored.
    const frame = requestAnimationFrame(() => {
      scroller.current?.scrollTo({ y: Math.max(0, at * ITEM_HEIGHT - height / 2 + ITEM_HEIGHT), animated: false });
      optionRefs.current[at]?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
    // Only as the menu appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  return (
    <>
      <html.button
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          anchor.current = el;
        }}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={rect !== null}
        onClick={() => void open()}
        style={[styles.button, style as never]}
      >
        {/* One string, so it takes the caller's text style as a button's own label does. */}
        {`${chosen?.label ?? ""}  ▾`}
      </html.button>
      {rect && (
        <Portal>
          <html.div
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={(el: any) => {
              if (el && !bounds) void measureAnchor(el).then(setBounds);
            }}
            style={styles.backdrop}
            onClick={dismiss}
          />
          {bounds && (
            <html.div
              role="listbox"
              onKeyDown={onMenuKey}
              style={[styles.menu, styles.menuAt(top, left, width, height)]}
            >
              <ScrollView ref={scroller}>
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
                    <html.span style={[styles.itemLabel, o.disabled && styles.itemLabelDisabled]}>{o.label}</html.span>
                  </html.button>
                ))}
              </ScrollView>
            </html.div>
          )}
        </Portal>
      )}
    </>
  );
});

const styles = css.create({
  button: {
    cursor: "pointer",
    textAlign: "start",
  },
  // Above every other overlay (popovers 50, body editor 100, cell notes 1000):
  // a select's menu is opened from inside them.
  backdrop: {
    position: "absolute",
    zIndex: 1999,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  menu: {
    position: "absolute",
    zIndex: 2000,
    // selectMenu's MENU_PADDING: StyleX styles take literals, not imported constants.
    paddingBlock: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#2c2c31",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1f",
    },
  },
  menuAt: (top: number, left: number, width: number, height: number) => ({
    top,
    left,
    width,
    height,
  }),
  item: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    // selectMenu's ITEM_HEIGHT.
    height: 28,
    paddingInline: 8,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": {
        default: "#f2f2f7",
        "@media (prefers-color-scheme: dark)": "#2a2a2e",
      },
    },
  },
  itemDisabled: {
    cursor: "default",
    backgroundColor: "transparent",
  },
  tick: {
    width: 14,
    fontSize: 12,
    color: {
      default: "#007aff",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  itemLabel: {
    flex: 1,
    fontSize: 13,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  itemLabelDisabled: {
    color: {
      default: "#aeaeb2",
      "@media (prefers-color-scheme: dark)": "#636366",
    },
  },
});
