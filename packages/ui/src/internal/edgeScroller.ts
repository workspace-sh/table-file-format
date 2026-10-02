// Web: scrolls the containers a dragged thing sits in, when the pointer
// holds near their edges. See edgeSpeed.ts for the speed.
import { edgeSpeed } from "./edgeSpeed";

type Axis = "x" | "y";

/** Containers around `from` that scroll, innermost first, ending at the page. */
function scrollParents(from: Element): Element[] {
  const parents: Element[] = [];
  const page = document.scrollingElement ?? document.documentElement;
  for (let el = from.parentElement; el && el !== document.body && el !== page; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)) parents.push(el);
  }
  parents.push(page);
  return parents;
}

/** Whether `el` can scroll further in a screen direction along `axis`. */
function room(el: Element, axis: Axis, direction: -1 | 1): boolean {
  const max = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
  if (max <= 0) return false;
  const pos = axis === "x" ? el.scrollLeft : el.scrollTop;
  // Right-to-left scrolls over -max..0, left-to-right over 0..max; either
  // way a larger scrollLeft is further right on screen.
  const rtl = axis === "x" && getComputedStyle(el).direction === "rtl";
  return direction < 0 ? pos > (rtl ? -max : 0) + 1 : pos < (rtl ? 0 : max) - 1;
}

/** Where a container is on screen: the page is the window. */
function bounds(el: Element): { left: number; right: number; top: number; bottom: number } {
  if (el === (document.scrollingElement ?? document.documentElement)) {
    return { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
  }
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

/**
 * Back on a snap point. Browsers don't re-snap a container whose snapping
 * was off while it scrolled, so it'd be left between two columns.
 */
function settleOnSnapPoint(el: HTMLElement) {
  if (!/^(x|inline|both)/.test(getComputedStyle(el).scrollSnapType)) return;
  const style = getComputedStyle(el);
  const rtl = style.direction === "rtl";
  const box = el.getBoundingClientRect();
  const padding = parseFloat(rtl ? style.scrollPaddingRight : style.scrollPaddingLeft) || 0;
  const line = rtl ? box.right - padding : box.left + padding;
  let nearest: number | null = null;
  for (const child of el.children) {
    if (getComputedStyle(child).scrollSnapAlign.split(" ")[0] !== "start") continue;
    const r = child.getBoundingClientRect();
    const offset = (rtl ? r.right : r.left) - line;
    if (nearest === null || Math.abs(offset) < Math.abs(nearest)) nearest = offset;
  }
  if (nearest !== null && Math.abs(nearest) > 1) el.scrollBy({ left: nearest, behavior: "smooth" });
}

export interface EdgeScroller {
  /** Scroll for `ms` with the pointer at (x, y); true when anything moved. */
  step: (x: number, y: number, ms: number) => boolean;
  /** End of the drag: give scroll snapping back its say. */
  release: () => void;
}

export function edgeScroller(source: Element): EdgeScroller {
  const parents = scrollParents(source);
  const loosened = new Map<HTMLElement, string>();

  const scrollBy = (el: Element, axis: Axis, delta: number) => {
    // Snapping would pull each step back to where it was.
    if (el instanceof HTMLElement && !loosened.has(el)) {
      loosened.set(el, el.style.scrollSnapType);
      el.style.scrollSnapType = "none";
    }
    if (axis === "x") el.scrollLeft += delta;
    else el.scrollTop += delta;
  };

  return {
    step(x, y, ms) {
      let moved = false;
      for (const axis of ["x", "y"] as const) {
        for (const el of parents) {
          const b = bounds(el);
          const speed = axis === "x" ? edgeSpeed(x, b.left, b.right) : edgeSpeed(y, b.top, b.bottom);
          if (speed === 0) continue;
          const direction = speed < 0 ? -1 : 1;
          if (!room(el, axis, direction)) continue;
          const before = axis === "x" ? el.scrollLeft : el.scrollTop;
          const delta = (speed * ms) / 1000;
          scrollBy(el, axis, Math.abs(delta) < 1 ? direction : Math.round(delta));
          if ((axis === "x" ? el.scrollLeft : el.scrollTop) !== before) moved = true;
          break;
        }
      }
      return moved;
    },
    release() {
      for (const [el, snap] of loosened) {
        el.style.scrollSnapType = snap;
        settleOnSnapPoint(el);
      }
      loosened.clear();
    },
  };
}
