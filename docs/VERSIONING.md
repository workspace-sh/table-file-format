# Versions and build numbers

Three things carry a number, and each has its own, because each answers a different question. Decided with Leslie on 10 Oct 2026.

| What | Its number | Example | The question it answers |
|---|---|---|---|
| An app build (web, Linux, iOS, macOS, Android) | The commit's date and which commit of that day, with the commit | `2026.10.10.3 · a7ebcce` | Which build am I testing, and how old is it? |
| A package on npm (`table-core`, `table-ui`, …) | Semantic versioning, at `0.x` until alpha | `0.4.0` | Will upgrading break my code? |
| The file format | `formatVersion`, a whole number (SPEC section 12) | `1` | Can this reader open this file? |

They move apart. A build's number changes with every commit; a package's when it is published; the format's only when files written the new way can't be read the old way.

## App builds

`2026.10.10.3 · a7ebcce` is the third commit on its branch on 10 October 2026 (UTC), built from commit `a7ebcce`.

- **Year, month, day:** the date of the commit it was built from, in UTC. Not the day it was built: the same commit gives the same number on any machine, on any day.
- **The last number:** its place among that day's commits on the branch's own line of history, from 1. It rises through the day and starts again the next.
- **The commit**, seven characters: exactly which code. The date says how old a build is; this says what is in it.
- **`+dev`** after the number (`2026.10.10.3+dev`): built from changes that weren't committed, so it isn't that commit's build. Never quote one in a report.
- A later build always sorts after an earlier one, and nobody decides whether a change is "major".

Nothing is typed in or kept in a file. `scripts/build-version.mjs` works it out from git:

```sh
node scripts/build-version.mjs          # 2026.10.10.3 · a7ebcce
node scripts/build-version.mjs --json   # { "version": …, "commit": …, "date": …, "dirty": … }
```

A build needs the branch's history to count the day's commits, so a CI checkout that builds an app uses `fetch-depth: 0`.

### Where to see it

| App | Where | How it gets there |
|---|---|---|
| Web demo | The foot of the sidebar: "Build 2026.10.10.3 · a7ebcce" | `apps/web/vite.config.ts` defines `__TABLE_BUILD__` |
| Linux | Main menu › About Tables | `apps/linux/vite.config.ts` defines `__TABLE_BUILD__` |
| iOS, Android, macOS | Not shown yet | To do: the app's config passes the script's answer in, and Settings shows `buildLabel()` |

Every app shows it through `buildLabel()` from `@workspace.sh/table-app`, so it reads the same everywhere. A bundle whose bundler didn't say reads "unnumbered build".

### For the stores

Apple wants a version of up to three numbers and a build number beside it; Android wants one whole number that only rises. Both come from the same answer:

| | From `2026.10.10.3` |
|---|---|
| Apple version (`CFBundleShortVersionString`) | `2026.10.10` |
| Apple build (`CFBundleVersion`) | `3` |
| Android `versionName` | `2026.10.10.3` |
| Android `versionCode` | `2026101003` |

### When reporting something

Quote the whole line, number and commit. "It's slow on 2026.10.10.3 · a7ebcce" can be looked up; "it's slow on the latest" can't.

## Packages

npm takes only `major.minor.patch`, and other people's tools read meaning into it (a caret range takes a minor release by itself, and not a major one). So the packages keep semantic versioning. Until alpha they stay at `0.x`, where any release may break.

## The format

`formatVersion` in a bundle's `meta.json` (SPEC section 12). It has nothing to do with which app wrote the file or when.
