// How a document's embedded tables are read and drawn, the same in every
// app that draws documents (Workspace's, on the phone and the Mac).
//
// Drawn all at once, a document's tables held the first one back until every
// one was done: each is a good deal of work on the one thread the page is
// drawn from. So they take turns, each once the one before has settled, the
// one nearest what's on screen first; and one far down a long document waits
// until the reader scrolls toward it. Until its turn, an embed keeps the room
// its link says it will take, as it does while it's read, so nothing moves
// while it waits.
//
// Drawing a table holds the page for several frames, so one off screen is
// drawn while the page is still, never while it's scrolled: drawn mid-scroll,
// the scroll stalled and then jumped. While the page is still, tables further
// ahead are drawn too, so the reader seldom scrolls to one not yet drawn.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageScroll } from "@workspace.sh/table-ui";
import { embedAddresses } from "./embed.ts";

/** The document's page, as table-ui's views know it (its PageScroll): what the order is kept over. */
export type EmbedPage = Pick<PageScroll, "now" | "subscribe" | "scrollBy" | "topOf">;

/** How far beyond what's on screen a table is drawn without being scrolled to, in screens: while the page is still. */
const AHEAD_SCREENS = 6;

/** How long the page holds still after a scroll before a table off screen is drawn. */
const STILL_MS = 250;

/** How long the page's width holds still, while a window is resized, before a drawn table takes the new one. */
const RESIZE_QUIET_MS = 300;

/** How long a table's height holds still before the next table's turn; and the longest a turn lasts. */
const SETTLE_QUIET_MS = 300;
const SETTLE_LIMIT_MS = 800;

export interface EmbedQueue {
  /**
   * Wait for a turn to draw what `view` holds: `go` is called when it's this
   * view's, and the next turn waits for what it returns (the table settled
   * into its size). Returns the way to stop waiting (the embed went away).
   */
  wait(view: unknown, go: () => Promise<void> | void): () => void;
}

interface Waiting {
  view: unknown;
  go: () => Promise<void> | void;
}

/** A document's queue, over its page. Without a page there is no order to keep: each draws at once. */
export function embedQueue(page: EmbedPage | null): EmbedQueue {
  if (!page) {
    return {
      wait: (_view, go) => {
        void go();
        return () => {};
      },
    };
  }
  const waiting = new Set<Waiting>();
  let busy = false;
  let listening: (() => void) | null = null;
  // When the page last scrolled, and the turn put off until it holds still.
  let offset = page.now().offset;
  let movedAt = -Infinity;
  let whenStill: ReturnType<typeof setTimeout> | null = null;
  const stopListening = () => {
    listening?.();
    listening = null;
    if (whenStill) clearTimeout(whenStill);
    whenStill = null;
  };
  // Scrolled since last seen. A jump (the page put back where the reader
  // left it, a link followed) is not scrolling: the reader waits where it
  // lands, so what's near is drawn at once.
  const noteMove = () => {
    const { offset: now, height } = page.now();
    if (now === offset) return;
    const jumped = Math.abs(now - offset) > height / 2;
    offset = now;
    if (jumped) return;
    movedAt = performance.now();
    if (whenStill) clearTimeout(whenStill);
    whenStill = setTimeout(() => {
      whenStill = null;
      void take();
    }, STILL_MS);
  };
  const onPage = () => {
    noteMove();
    void take();
  };

  // A frame drawn after the last turn, so the table just drawn is on screen before the next starts.
  const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

  // Asked again while a turn was being chosen or drawn: choose again after.
  let again = false;
  const take = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    if (waiting.size === 0) return;
    busy = true;
    again = false;
    let drew = false;
    try {
      const measured = await Promise.all([...waiting].map(async (w) => ({ w, top: await page.topOf(w.view) })));
      // Where the page is once they're measured: it may have moved meanwhile.
      const { offset, height } = page.now();
      let next: Waiting | null = null;
      let nearest = Infinity;
      for (const { w, top } of measured) {
        if (!waiting.has(w)) continue;
        // One that can't be measured comes after those that can, rather than never.
        const distance =
          top === null ? AHEAD_SCREENS * height : top < offset ? offset - top : Math.max(0, top - (offset + height));
        if (distance < nearest) {
          nearest = distance;
          next = w;
        }
      }
      // Scrolling: only one on screen is drawn now (it would otherwise show
      // its empty room); the rest wait until the page holds still.
      const still = performance.now() - movedAt >= STILL_MS;
      if (!next || nearest > (still ? AHEAD_SCREENS * height : 0)) return;
      waiting.delete(next);
      if (waiting.size === 0) stopListening();
      // The next is started once this one has settled: started a frame
      // later, it took the thread while this one was still measuring its
      // columns, and this one was shown later for it.
      await next.go();
      await nextFrame();
      drew = true;
    } finally {
      busy = false;
    }
    if (drew || again) void take();
  };

  return {
    wait: (view, go) => {
      const w = { view, go };
      waiting.add(w);
      // Scrolled toward, or moved by what's above it: maybe its turn now.
      if (!listening) {
        // Wherever the page is now is where it starts from.
        offset = page.now().offset;
        listening = page.subscribe(onPage);
      }
      void take();
      return () => {
        waiting.delete(w);
        if (waiting.size === 0) stopListening();
      };
    },
  };
}

/**
 * An embed's turn: `turn` once it's this embed's (until then it draws the
 * room it's kept), `settled` once its table is drawn and its height has held
 * still, `heldAt` while the page's width is changing (the width for what's
 * drawn to keep until it holds still), with the `host` ref and `onLayout`
 * (height, and width) for the view around it. Only something to draw
 * (`ready`) waits for one.
 *
 * Its turn ends once its height has held still a moment (the table measures
 * its columns after its first layout), or after a limit. And drawn above
 * what's on screen, each change in the table's height (its own in place of
 * the room it was kept, then again once its columns are measured) scrolls
 * the page by the difference, so what the reader is
 * looking at stays where it is.
 */
export function useEmbedTurn<V>(queue: EmbedQueue, ready: boolean, page: EmbedPage | null) {
  const host = useRef<V>(null);
  const [turn, setTurn] = useState(false);
  // Drawn, and its height has held still (or the turn's limit passed).
  const [settledTurn, setSettledTurn] = useState(false);
  const height = useRef<number | null>(null);
  const settled = useRef<(() => void) | null>(null);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTurn = () => {
    if (quiet.current) clearTimeout(quiet.current);
    if (limit.current) clearTimeout(limit.current);
    if (settled.current) setSettledTurn(true);
    settled.current?.();
    settled.current = null;
  };
  useEffect(() => endTurn, []);

  // Drawn while the page's width changes (a window being resized): the width
  // it had, which it keeps until the width holds still. At every step of a
  // resize each of its cells was laid out and moved again; a phone's width
  // changes at once, so it never holds there.
  const width = useRef<number | null>(null);
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (release.current) clearTimeout(release.current);
  }, []);
  useEffect(() => {
    if (!ready || turn) return;
    return queue.wait(host.current, () => new Promise<void>((done) => {
      settled.current = done;
      limit.current = setTimeout(endTurn, SETTLE_LIMIT_MS);
      setTurn(true);
    }));
  }, [queue, ready, turn]);

  const onLayout = (h: number, w?: number) => {
    if (w !== undefined) {
      const was = width.current;
      width.current = w;
      if (turn && was !== null && was !== w) {
        setHeldAt((held) => held ?? was);
        if (release.current) clearTimeout(release.current);
        release.current = setTimeout(() => setHeldAt(null), RESIZE_QUIET_MS);
      }
    }
    const before = height.current;
    height.current = h;
    if (before !== h && settled.current) {
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = setTimeout(endTurn, SETTLE_QUIET_MS);
    }
    // Every change, not only the first: the table measures its columns
    // after its first layout, and grows again then.
    if (before === null || before === h || !page) return;
    void page.topOf(host.current).then((top) => {
      if (top !== null && top + before <= page.now().offset) page.scrollBy(h - before);
    });
  };
  return { host, turn, settled: settledTurn, heldAt, onLayout };
}

/**
 * Start reading what the document embeds as soon as its text is known
 * (`read`, the document's reader, which hands each embed the read already
 * under way). Its embeds are only placed once the text is laid out, and each
 * read its file then. It follows what the text embeds, not the text, so
 * typing in the document reads nothing again.
 */
export function useReadEmbedsEarly(markdown: string, read: ((address: string) => void) | null): void {
  const addresses = useMemo(() => embedAddresses(markdown).join("\n"), [markdown]);
  useEffect(() => {
    if (!read || addresses === "") return;
    for (const address of addresses.split("\n")) read(address);
  }, [addresses, read]);
}
