import { test } from "node:test";
import assert from "node:assert/strict";
import { pageScrollOver } from "./pageScroll.ts";

test("a page made with a lock holds still and lets go through it", () => {
  const calls: boolean[] = [];
  const page = pageScrollOver({ current: null }, { lock: (on) => calls.push(on) });
  page.pageScroll.lock?.(true);
  page.pageScroll.lock?.(false);
  assert.deepEqual(calls, [true, false]);
});

test("a page made without one has no lock, so nothing tries to hold it", () => {
  const page = pageScrollOver({ current: null });
  assert.equal(page.pageScroll.lock, undefined);
});

test("laid out, the page measures where its scroll view is in the window itself", () => {
  const scroller = {
    scrollTo: () => {},
    measureInWindow: (done: (x: number, y: number) => void) => done(0, 120),
  };
  const page = pageScrollOver({ current: scroller });
  page.onLayout({ nativeEvent: { layout: { height: 600 } } });
  page.onScroll({ nativeEvent: { contentOffset: { y: 40 } } });
  assert.equal(page.pageScroll.windowTop(), 80, "its top in the window, less what's scrolled");
  assert.deepEqual(page.pageScroll.now(), { offset: 40, height: 600, inset: 0 });
});

test("scrolled up, a page stops where its top sits under a bar", () => {
  const to: number[] = [];
  const page = pageScrollOver({ current: { scrollTo: ({ y }: { y: number }) => void to.push(y) } });
  page.onScroll({ nativeEvent: { contentOffset: { y: 10 }, contentInset: { top: 52 } } });
  page.pageScroll.scrollBy(-200);
  assert.deepEqual(to, [-52]);
});
