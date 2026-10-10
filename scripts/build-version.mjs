// A build's number (docs/VERSIONING.md): the date of the commit it was built
// from, and which commit of that day it is, with the commit beside it.
//
//   2026.10.10.3 · a7ebcce     the third commit on develop on 10 Oct 2026 (UTC)
//
// It comes from git alone, so the same commit gives the same number on any
// machine, and nobody keeps a counter. Run it to print one; the apps' build
// configs import `buildInfo` and put it in the bundle.

import { execFileSync } from "node:child_process";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** @returns {{ version: string, commit: string, date: string, dirty: boolean }} */
export function buildInfo(cwd = process.cwd()) {
  try {
    const commit = git(cwd, "rev-parse", "--short=7", "HEAD");
    // The commit's own time, in UTC: a day is the same day wherever it is built.
    const when = new Date(Number(git(cwd, "show", "-s", "--format=%ct", "HEAD")) * 1000);
    const date = when.toISOString().slice(0, 10);
    // Its place among that day's commits on this line of history, from 1.
    const nth = Number(git(cwd, "rev-list", "--count", "--first-parent", `--since=${date}T00:00:00Z`, `--until=${date}T23:59:59Z`, "HEAD"));
    // Changes not committed: the number says so, since it isn't that commit's build.
    const dirty = git(cwd, "status", "--porcelain", "--untracked-files=no").length > 0;
    const [y, m, d] = date.split("-").map(Number);
    return { version: `${y}.${m}.${d}.${Math.max(1, nth)}${dirty ? "+dev" : ""}`, commit, date, dirty };
  } catch {
    // Not a git checkout (a source archive): nothing to say but that.
    return { version: "0.0.0.0", commit: "unknown", date: "", dirty: false };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const info = buildInfo();
  console.log(process.argv.includes("--json") ? JSON.stringify(info) : `${info.version} · ${info.commit}`);
}
