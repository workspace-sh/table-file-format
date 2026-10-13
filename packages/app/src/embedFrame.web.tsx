// The embed's frame and dialog on the web: a box that scrolls once what it
// holds is taller than the limit (table-ui's web list follows the nearest
// box that scrolls it), and the browser's confirm for a question. See
// embedView.shared.tsx.

import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";

import { confirmText, type Confirm } from "./confirm.ts";
import { EMBED_MAX_HEIGHT, TableEmbedWith, type TableEmbedProps } from "./embedView.shared.tsx";

export { EMBED_MAX_HEIGHT, type TableEmbedProps };

function Frame({ limit, children }: { limit: number; children: ReactNode }) {
  return <html.div style={styles.frame(limit)}>{children}</html.div>;
}

function ask(confirm: Confirm, answer: (response: string) => void) {
  // window.confirm has two answers: OK is the question's own (the last), Cancel is cancel.
  const ok = confirm.responses.length === 1 ? (window.alert(confirmText(confirm)), true) : window.confirm(confirmText(confirm));
  answer(ok ? confirm.responses.at(-1)!.id : "cancel");
}

export function TableEmbed(props: TableEmbedProps) {
  return TableEmbedWith(props, Frame, ask);
}

const styles = css.create({
  frame: (limit: number) => ({ maxHeight: limit, overflowY: "auto", position: "relative" }),
});
