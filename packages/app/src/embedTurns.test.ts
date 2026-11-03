import { test } from "node:test";
import assert from "node:assert/strict";
import { embedQueue, STILL_MS, type EmbedPage } from "./embedTurns.ts";

// requestAnimationFrame, as the page's frames: soon after.
globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 1)) as typeof requestAnimationFrame;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Until `done()` is true, or `limit` ms have passed (a slow machine's timers run late). */
async function until(done: () => boolean, limit = 2000): Promise<boolean> {
  const start = Date.now();
  while (!done() && Date.now() - start < limit) await wait(10);
  return done();
}

/** A page one screen (1000) tall, with views at the tops given. */
function page(tops: Map<unknown, number>) {
  let offset = 0;
  type Listener = Parameters<EmbedPage["subscribe"]>[0];
  const listeners = new Set<Listener>();
  const p: EmbedPage = {
    now: () => ({ offset, height: 1000 }) as ReturnType<EmbedPage["now"]>,
    subscribe: (f: Listener) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    scrollBy: () => {},
    topOf: async (v: unknown) => tops.get(v) ?? null,
  } as EmbedPage;
  return { p, scrollTo: (y: number) => { offset = y; for (const f of listeners) f("scroll"); } };
}

test("a table off screen is drawn once the page holds still, not while it scrolls", async () => {
  const below = {};
  const { p, scrollTo } = page(new Map([[below, 3000]]));
  const queue = embedQueue(p);
  // When it was drawn, against when the page last scrolled: a slow machine's late timers
  // can't make a right answer look wrong, as a fixed wait before looking could.
  let drawnAt: number | null = null;
  queue.wait(below, () => { drawnAt = performance.now(); });
  scrollTo(100);
  await wait(50);
  scrollTo(200);
  const scrolled = performance.now();
  assert.equal(await until(() => drawnAt !== null), true, "never drawn");
  assert.ok(drawnAt! >= scrolled, "drawn mid-scroll");
  assert.ok(drawnAt! - scrolled >= STILL_MS - 5, `drawn ${Math.round(drawnAt! - scrolled)} ms after the last scroll, before the page held still`);
});

test("a table off screen is drawn once the page holds still, when the timer for it fires a moment early", async () => {
  // A timer can fire before the clock says it's due; the table is drawn all the same, not left waiting for a scroll.
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((f: () => void, ms?: number) => real(f, Math.max(0, (ms ?? 0) - 5))) as typeof setTimeout;
  try {
    const below = {};
    const { p, scrollTo } = page(new Map([[below, 3000]]));
    const queue = embedQueue(p);
    let drawn = false;
    queue.wait(below, () => { drawn = true; });
    scrollTo(100);
    assert.equal(await until(() => drawn), true, "left waiting after the page held still");
  } finally {
    globalThis.setTimeout = real;
  }
});

test("a table on screen is drawn while the page scrolls", async () => {
  const shown = {};
  const { p, scrollTo } = page(new Map([[shown, 500]]));
  const queue = embedQueue(p);
  scrollTo(100);
  let drawn = false;
  queue.wait(shown, () => { drawn = true; });
  assert.equal(await until(() => drawn, 100), true, "an on-screen table waited for the page to be still");
});

test("a jump is not scrolling: what's near where it lands is drawn at once", async () => {
  const near = {};
  const { p, scrollTo } = page(new Map([[near, 20000]]));
  const queue = embedQueue(p);
  let drawn = false;
  queue.wait(near, () => { drawn = true; });
  scrollTo(18500);
  assert.equal(await until(() => drawn, 100), true, "a jump was taken for scrolling");
});

test("one far beyond what's ahead waits for the reader", async () => {
  const far = {};
  const { p } = page(new Map([[far, 20000]]));
  let drawn = false;
  embedQueue(p).wait(far, () => { drawn = true; });
  await wait(400);
  assert.equal(drawn, false);
});
