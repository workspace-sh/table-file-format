// Asking for a name (a new table, a new .table file), worded by
// table-app's namePrompt: a small sheet with a text box, the same on iOS
// and Android, which has no system text prompt.

import { useRef, useState } from "react";
import { Modal } from "react-native";
import { html, css } from "react-strict-dom";
import type { NamePrompt } from "@workspace.sh/table-app";

export interface NameSheetProps {
  /** The question, or null when none is being asked. */
  prompt: NamePrompt | null;
  /** The name typed, or null when cancelled. */
  onAnswer: (name: string | null) => void;
}

/**
 * Focus a text box: react-strict-dom's ref is a copy of the native
 * element, whose focus() does nothing, so it's TextInput's own (#281).
 */
function focusBox(el: { focus?: () => void; getNativeRef?: () => { focus?: () => void } | null }) {
  (el.getNativeRef?.() ?? el).focus?.();
}

export function NameSheet({ prompt, onAnswer }: NameSheetProps) {
  const [name, setName] = useState("");
  // Focused once as the sheet opens, not on every keystroke.
  const focused = useRef(false);
  if (prompt === null) focused.current = false;
  const answer = (value: string | null) => {
    setName("");
    onAnswer(value);
  };
  return (
    <Modal visible={prompt !== null} transparent animationType="fade" onRequestClose={() => answer(null)}>
      <html.div style={styles.backdrop}>
        <html.div style={styles.card}>
          <html.span style={styles.heading}>{prompt?.heading ?? ""}</html.span>
          <html.input
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={(el: any) => {
              if (!el || focused.current) return;
              focused.current = true;
              focusBox(el);
            }}
            type="text"
            value={name}
            placeholder={prompt?.placeholder}
            aria-label={prompt?.placeholder}
            enterKeyHint="done"
            onChange={(e: { target: { value: string } }) => setName(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === "Enter") answer(name);
            }}
            style={styles.input}
          />
          <html.div style={styles.buttons}>
            <html.button onClick={() => answer(null)} style={styles.button}>
              Cancel
            </html.button>
            <html.button onClick={() => answer(name)} style={[styles.button, styles.action]}>
              {prompt?.action ?? "OK"}
            </html.button>
          </html.div>
        </html.div>
      </html.div>
    </Modal>
  );
}

const text = { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" };
const blue = { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" };

const styles = css.create({
  // The card sits high, clear of the keyboard that opens with it.
  backdrop: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    alignItems: "stretch",
    paddingInline: 32,
    paddingTop: 140,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 18,
    borderRadius: 14,
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1e" },
  },
  heading: { fontSize: 17, fontWeight: "600", textAlign: "center", color: text },
  input: {
    minHeight: 40,
    paddingInline: 10,
    fontSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    color: text,
  },
  buttons: { display: "flex", flexDirection: "row", gap: 10 },
  button: {
    flex: 1,
    minHeight: 44,
    fontSize: 17,
    borderRadius: 10,
    borderWidth: 0,
    backgroundColor: { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#2c2c2e" },
    color: blue,
  },
  action: { fontWeight: "600" },
});
