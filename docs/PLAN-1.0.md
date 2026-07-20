# Execution plan — `.table/` 1.0 over the line

> Handoff document. Written at the close of the architectural review
> (docs/REVIEW.md, PR #47) for execution by a later session with **no
> access to the authoring conversation**. Everything needed is in this
> file, docs/REVIEW.md, and the linked issues. Work top to bottom;
> phases are ordered by dependency.

## Context

`.table/` is a portable table/database file format (see docs/SPEC.md).
The spec vocabulary is settled, the review is done, and the goal now is
to **freeze formatVersion 1 and make the format consumable by the
Workspace app**. The architectural review (docs/REVIEW.md) found the
format 1.0-ready in shape; this plan resolves the remaining blockers.

**Sequencing ruling (maintainer-confirmed):** the P2P sync core does
NOT precede Workspace integration. `.table/` support ships first; the
P2P layer later materialises the same files underneath it. The file
layer is the interface (DECISIONS D14/D17). The only P2P coupling
points are the four contract rulings below — settling them is what
makes the later retrofit non-breaking.

## Settled rulings (encode these; do not re-litigate)

| # | Question | Ruling |
|---|---|---|
| R1 | Access model (REVIEW section C) | **Reconcile.** "No private layer" = no hidden per-user *state*; `x-tier` = per-field *access granularity* (all key-holders of a field see identical values). Apply the exact wording from REVIEW section F item 2 to both PRIOR-ART.md and PERMISSIONS.md. PERMISSIONS stays a design doc for the future sync layer (it already says "not yet implemented"). |
| R2 | `schema-version` under sync (#45) | **Scope to single-writer.** Keep the integer. SPEC states: meaningful only without concurrent writers; under multi-writer sync it is advisory and the sync layer's linearisation order is authoritative. Record as a DECISIONS entry (next free number). |
| R3 | Parser posture (#44) | **Skip-and-collect.** Parse valid rows; collect per-line diagnostics; a bad line is a reported skip, not a total failure. SPEC states the reader contract. |
| R4 | Row-id fix (#42) | **Case-safe alphabet.** `customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 25)` (~128-bit). Also align SPEC with validator reality: writer-minted ids SHOULD use this shape; any non-empty, unique, filename-safe string is *valid* (fixtures use hand-authored ids like `p1` — that stays legal; the maintainer explicitly wants human-readable ids possible outside a managed workspace). |

Also settled by default (low stakes): **#46** → attachments resolution
is the app's concern; soften SPEC section 6 accordingly (option 2 in
the issue).

## Phase 0 — Merge train

Land the seven open PRs. Order matters for the docs/core cluster
(shared files: SPEC.md, DECISIONS.md, ARCHITECTURE.md,
`packages/core/src/index.ts`).

1. Merge **#39** (docs/storage-sync).
2. Rebase **#40** (feat/schema-vocabulary) on develop; resolve
   append-only conflicts in SPEC/DECISIONS/index.ts (sections are
   disjoint — D15–D17 from #39, D18–D21 from #40; keep both). Merge.
3. Rebase **#41** (feat/csv-converter) on develop; same treatment.
   Merge.
4. Merge **#30** (docs/prior-art) and **#26** (docs/permissions) —
   no collisions.
5. Verify **#24** (feat/native-drag-parity) carries nothing beyond
   what merged in #28 (drag-drop already on develop, commit
   `e5c5948`); if so, close #24 with a supersession note.
6. Rebase + merge **#29** (feat/mobile-view-pass).
7. Merge **#47** (docs/final-review — REVIEW.md + this file).

Gate: after each merge, `npm run typecheck` and `npm run core:test`
green on develop.

## Phase 1 — Post-merge doc alignment (REVIEW section F appendix)

All on one branch (`docs/one-oh-alignment`):

1. **PRIOR-ART.md refresh** — apply REVIEW section F item 1 (map gap
   items to issues #31–#35 and PRs #40/#41; remove "no issue yet"
   notes).
2. **Access-model wording (R1)** — apply REVIEW section F item 2
   verbatim to PRIOR-ART.md and PERMISSIONS.md.
3. **SPEC section 6 (#46)** — change "the reader resolves under
   `attachments/`" to resolution being the consuming app's concern
   (like relations); note the reference core loads `bodies/` but not
   `attachments/`, and that this asymmetry is intentional. Close #46.
4. **Platform notes (REVIEW D5)** — short "platform realities"
   paragraph in ARCHITECTURE.md (macOS bundle/UTI, iOS file-provider,
   Android SAF, zip-for-transport, case-insensitive checkouts).
5. **Tombstone note (REVIEW D6)** — one sentence in
   STORAGE-AND-SYNC.md: row-delete vs concurrent field-update needs a
   tombstone rule; owned by the sync layer, flagged here.

## Phase 2 — Code fixes (each its own PR, tests first)

1. **#42 — id alphabet (R4).** `packages/core/src/id.ts` →
   `customAlphabet` lowercase+digits, length 25. Update SPEC section 3
   (System `id`): SHOULD-shape for minted ids, validity = non-empty +
   unique (+ filename-safe note referencing the case-folding
   rationale). DECISIONS entry. Test: minted ids match
   `/^[0-9a-z]{25}$/`; add a case-fold collision regression test on
   ids-as-filenames.
2. **#43 — writer atomicity.** `packages/core/src/writer.ts`: write
   every file to `<name>.tmp` in the same directory then `rename`;
   bodies/ writes staged the same way, deletions last. Document the
   writer atomicity contract in SPEC (parallel to the `index.sqlite`
   temp+rename rule). Test: inject a failure between file writes and
   assert the directory parses as either fully-old or fully-new.
3. **#44 — parser skip-and-collect (R3).** `parseTable` collects
   per-line diagnostics (reuse the `ValidationError` shape from
   `validator.ts`) instead of throwing on a malformed line / missing
   row id; missing-or-malformed `schema.json` remains fatal (a
   `.table/` without a readable schema is not a table). Surface
   diagnostics on the returned value; SPEC states the contract.
   Tests: bad line skipped + reported; conflict-marker line skipped;
   good rows survive.
4. **#45 — schema-version scope (R2).** Docs-only: SPEC section on
   `schema-version` + a DECISIONS entry. Close #45.

Gate: full `npm run typecheck` + `npm run core:test` after each PR;
no UI package changes required by any of these.

## Phase 3 — Freeze

1. SPEC.md header: remove "Spike-status … will move before 1.0";
   state `formatVersion: 1` is frozen — additive changes only,
   breaking changes bump the major.
2. README status block: spike → stable format, API still evolving.
3. DECISIONS entry recording the freeze and its date.
4. Git tag `format-v1` on the freeze commit.

## Phase 4 — Workspace-readiness (this repo only)

**Hard boundary: the Workspace app repo
(`~/Code/Projects/workspace/workspace`) is READ-ONLY. Never write to
it. All work happens in this repo; Workspace-side integration is a
separate effort by the maintainer.**

1. Verify `@workspace.sh/table-core` consumes cleanly from outside:
   exports map (browser-safe barrel + `/parser`, `/writer` subpaths)
   resolves under Node, Metro, and Vite. Fix export-map gaps only.
2. Optional, if cheap: **#7** granular named exports.
3. Write `docs/INTEGRATION.md`: a consumer's guide for the Workspace
   team — parse → validate → applyView → render pipeline, the write
   path (atomicity contract), the id rules, what lives outside the
   format (per-user state, ACLs), and the sync-later posture (files
   are the interface; nothing in the consumer changes when P2P
   arrives).

## Standing constraints

- PR-driven workflow into `develop`; never push develop directly
  (DECISIONS D13). Branch names `feat/…`, `fix/…`, `docs/…`.
- Commits end with the Claude Code co-author trailer.
- The section-sign symbol must never appear in any text — write
  "section N" / "D14" in plain words (maintainer rule, twice flagged).
- British English in all prose.
- Backlog lives in GitHub issues; close each issue as its phase lands.

## Definition of done

- All seven review-era PRs merged or closed; issues #42–#46 closed.
- develop: typecheck + tests green; SPEC frozen at formatVersion 1;
  tag `format-v1` pushed.
- `docs/INTEGRATION.md` exists and matches the shipped API.
- A fresh checkout can: parse the fixtures, render them in all three
  demo apps, round-trip a write, and survive a malformed row with a
  diagnostic instead of a crash.
