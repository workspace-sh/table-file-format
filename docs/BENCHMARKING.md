# Benchmarking

How performance is measured in this repo, so numbers can be compared from one run, one change and one machine to the next. Results go in the doc they're about (large tables: [LARGE-TABLES.md](LARGE-TABLES.md)), with the date, the build and the machine.

## Release builds only

**Performance is only ever measured in a Release (production) build.** Development builds are for UI work: checking how something looks and behaves, and tweaking it.

A development build is several times slower, by different amounts in different places: React checks every element, Hermes runs without its optimisations, and the debugger connection adds work. Its numbers say little about what someone holding the app will feel, and they can rank two approaches the wrong way round.

| Platform | Build to measure |
|---|---|
| iOS | `expo run:ios --configuration Release`, with `EXPO_PUBLIC_TABLE_MEASURE=1` when the app needs to open test files or report (see below). |
| Web | `npm run web:build`, then `npm run web:preview`. Not the Vite dev server. |
| macOS | The Release configuration of the Xcode scheme. |

A development build can show whether something works at all before a Release build is worth making. Its numbers aren't reported.

## Where

- **A real device is the reference.** Leslie's iPhone (16 Pro) is the phone to beat. Device builds are Leslie's to run.
- **The Simulator** (on an Apple silicon Mac) is fine for comparing two approaches, since both run on the same machine. It has more memory than a phone and its CPU is a Mac's, so its absolute numbers are optimistic. Say so next to them.
- Measure one thing at a time, with nothing else heavy running.

## How

- **Clean state.** Reinstall the app (or clear the page's storage) before each run, so saved data from an earlier run doesn't load too.
- **Same data every time.** `scripts/big-table.mts <rows> <dir>` writes a seeded table, identical on every run.
- **Through the real path.** Open test files as a person's file is opened (`openArchive`), not by a shortcut.
- **Real input for anything touch-driven.** Scroll with real flicks (the Simulator's touch injection, or a finger), not by moving the scroll position from code: scripted scrolling measures the scrolling call, not the scrolling.
- **Give each candidate its fair setup.** Configure every library as its own docs recommend for the case (for example a list's fixed row height), and say what was set. An unconfigured library loses for the wrong reason.
- **Report:** the build, the platform and OS, the machine, the data size, and each number's unit. Report memory as the process's peak resident size, sampled while it runs.

## Tools

- `scripts/big-table.mts`: seeded large tables, as a folder and a `.table.zip`.
- `scripts/big-table-read.mts`: the data side alone (reading and computing), with no drawing.
- `scripts/big-table-index.mts`: a view read through the index (windows, groups, totals, places, an edit), with no drawing.
- `scripts/measure-server.py <dir>`: serves test files to a measuring build. `GET /next` names what to open, and `POST /result` collects what it reports into `results.ndjson`.
- `apps/mobile/measure.ts`: in a build made with `EXPO_PUBLIC_TABLE_MEASURE=1`, opens what the server names and reports the times. `bench <flash|legend> <rows>` opens the list benchmark (`apps/mobile/app/bench.tsx`) instead. Ordinary builds run none of it.
