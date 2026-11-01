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

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageScroll } from "@workspace.sh/table-ui";
import { embedAddresses } from "./embed.ts";

/** The document's page, as table-ui's views know it (its PageScroll): what the order is kept over. */
export type EmbedPage = Pick<PageScroll, "now" | "subscribe" | "scrollBy" | "topOf">;

/** How far beyond what's on screen a table is drawn without being scrolled to, in screens. */
const AHEAD_SCREENS = 2;

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
  const stopListening = () => {
    listening?.();
    listening = null;
  };

  // A frame drawn after the last turn, so the table just drawn is on screen before the next starts.
  const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

  const take = async () => {
    if (busy || waiting.size === 0) return;
    busy = true;
    try {
      const { offset, height } = page.now();
      const measured = await Promise.all([...waiting].map(async (w) => ({ w, top: await page.topOf(w.view) })));
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
      if (!next || nearest > AHEAD_SCREENS * height) return;
      waiting.delete(next);
      if (waiting.size === 0) stopListening();
      // The next is started once this one has settled: started a frame
      // later, it took the thread while this one was still measuring its
      // columns, and this one was shown later for it.
      await next.go();
      await nextFrame();
    } finally {
      busy = false;
    }
    void take();
  };

  return {
    wait: (view, go) => {
      const w = { view, go };
      waiting.add(w);
      // Scrolled toward, or moved by what's above it: maybe its turn now.
      listening ??= page.subscribe(() => void take());
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
 * room it's kept), with the `host` ref and `onLayout` for the view around
 * it. Only something to draw (`ready`) waits for one.
 *
 * Its turn ends once its height has held still a moment (the table measures
 * its columns after its first layout), or after a limit. And drawn above
 * what's on screen, the table takes its own height in place of the room it
 * was kept: the page scrolls by the difference, so what the reader is
 * looking at stays where it is.
 */
export function useEmbedTurn<V>(queue: EmbedQueue, ready: boolean, page: EmbedPage | null) {
  const host = useRef<V>(null);
  const [turn, setTurn] = useState(false);
  const settling = useRef(false);
  const height = useRef<number | null>(null);
  const settled = useRef<(() => void) | null>(null);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTurn = () => {
    if (quiet.current) clearTimeout(quiet.current);
    if (limit.current) clearTimeout(limit.current);
    settled.current?.();
    settled.current = null;
  };
  useEffect(() => endTurn, []);
  useEffect(() => {
    if (!ready || turn) return;
    return queue.wait(host.current, () => new Promise<void>((done) => {
      settled.current = done;
      limit.current = setTimeout(endTurn, SETTLE_LIMIT_MS);
      settling.current = true;
      setTurn(true);
    }));
  }, [queue, ready, turn]);

  const onLayout = (h: number) => {
    const before = height.current;
    height.current = h;
    if (before !== h && settled.current) {
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = setTimeout(endTurn, SETTLE_QUIET_MS);
    }
    if (!settling.current || before === null || before === h || !page) return;
    settling.current = false;
    void page.topOf(host.current).then((top) => {
      if (top !== null && top + before <= page.now().offset) page.scrollBy(h - before);
    });
  };
  return { host, turn, onLayout };
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
