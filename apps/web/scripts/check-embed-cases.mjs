// Checks the embed cases on the web: opens the `#embed-test` page in headless
// Firefox (dark, as the app is looked at), scrolls through it until every
// case has drawn, and prints the cases that don't draw what workspace-fixtures'
// cases files say. Exits 1 unless every case is as expected.
//
//   npm run dev -w @workspace.sh/table-web        # in one terminal
//   npm run embed-cases:check -w @workspace.sh/table-web [-- http://localhost:5173/#embed-test]
//
// Needs Firefox (WebDriver BiDi) and a free port 9333.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:5173/#embed-test";
const profile = mkdtempSync(join(tmpdir(), "embed-cases-firefox-"));
writeFileSync(join(profile, "user.js"), 'user_pref("ui.systemUsesDarkTheme", 1);\nuser_pref("layout.css.prefers-color-scheme.content-override", 0);\n');
const firefox = spawn("firefox", ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", "9333"], { stdio: ["ignore", "ignore", "pipe"] });
await new Promise((ready) => firefox.stderr.on("data", (d) => String(d).includes("WebDriver BiDi listening") && ready()));

const ws = new WebSocket("ws://127.0.0.1:9333/session");
await new Promise((open) => (ws.onopen = open));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) =>
  new Promise((answer) => {
    const n = ++id;
    pending.set(n, answer);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

// In the page: through it until every case has passed, or four times (a large table's index takes a moment).
const check = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const summary = () => document.querySelector("[data-testid=embed-cases-summary]")?.innerText ?? "";
  const done = () => /^(\\d+) of \\1 /.test(summary());
  for (let i = 0; i < 60 && !/ of \\d+ cases/.test(summary()); i++) await wait(500);
  await wait(3000);
  for (let pass = 0; pass < 4 && !done(); pass++) {
    for (const s of document.querySelectorAll("section")) { s.scrollIntoView({ block: "center" }); await wait(400); }
    await wait(1500);
  }
  const failing = [...document.querySelectorAll("section p")].map((p) => p.innerText).filter((t) => t.startsWith("✗"));
  return JSON.stringify({ summary: summary(), done: done(), failing });
})()`;

try {
  await send("session.new", { capabilities: {} });
  const context = (await send("browsingContext.getTree")).result.contexts[0].context;
  await send("browsingContext.setViewport", { context, viewport: { width: 1366, height: 900 } });
  await send("browsingContext.navigate", { context, url, wait: "complete" });
  const answer = await send("script.evaluate", { expression: check, target: { context }, awaitPromise: true });
  const { summary, done, failing } = JSON.parse(answer.result?.result?.value ?? '{"summary":"the page gave no answer","done":false,"failing":[]}');
  for (const line of failing) console.log(line);
  console.log(summary || "no cases on the page: is it the #embed-test page of a dev server?");
  process.exitCode = done ? 0 : 1;
} finally {
  firefox.kill();
  rmSync(profile, { recursive: true, force: true });
}
