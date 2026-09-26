/**
 * Web variant: a small card that appears when the pointer rests on an
 * element, like Notion's and Superhuman's hints. Spread `props` onto the
 * element; render `element` anywhere (it portals to the body, so a
 * clipping table can't cut it off).
 *
 * Shown after a short rest, never on touch, and gone the moment the
 * pointer leaves or presses: a hint must never sit in front of what a
 * click opens.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";

import { Portal } from "./Portal";

export interface HoverHint {
  props: Record<string, unknown>;
  element: ReactNode;
}

const CARD_WIDTH = 280;
const GAP = 6;
const EDGE = 8;

interface Place {
  top: number;
  left: number;
  above: boolean;
}

export function useHoverHint(hint: ReactNode, { delayMs = 450 }: { delayMs?: number } = {}): HoverHint {
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [place, setPlace] = useState<Place | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlace(null);
  };
  useEffect(() => cancel, []);

  const props = {
    ref: (el: HTMLElement | null) => {
      target.current = el;
    },
    onPointerEnter: (e: { pointerType?: string }) => {
      if (e.pointerType === "touch" || hint == null) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const el = target.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Below the element, unless that runs off the bottom; kept inside
        // the window sideways.
        const above = r.bottom + GAP + 120 > window.innerHeight;
        const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - CARD_WIDTH - EDGE);
        setPlace({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
      }, delayMs);
    },
    onPointerLeave: cancel,
    onPointerDown: cancel,
  };

  const element = place ? (
    <Portal>
      <html.div role="tooltip" style={[styles.card, styles.at(place.top, place.left), place.above && styles.above]}>
        {hint}
      </html.div>
    </Portal>
  ) : null;

  return { props, element };
}

const styles = css.create({
  card: {
    position: "fixed",
    zIndex: 60,
    width: CARD_WIDTH,
    // Padding and border inside the width, so the edge clamp is exact.
    boxSizing: "border-box",
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    fontSize: 12,
    lineHeight: 1.4,
    // A plain-text hint may carry line breaks (a list of problems, say).
    whiteSpace: "pre-line",
    pointerEvents: "none",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#2c2c31",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1f",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  at: (top: number, left: number) => ({ top, left }),
  above: {
    transform: "translateY(-100%)",
  },
});
