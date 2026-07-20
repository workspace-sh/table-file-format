# Architectural review — `.table/` toward 1.0

> Status: review artefact, not normative. Produced as a pre-1.0
> confirmation / alignment pass over the whole corpus (SPEC,
> DECISIONS, ARCHITECTURE, STORAGE-AND-SYNC, PRIOR-ART, PERMISSIONS,
> README) plus the reference implementation and the
> `workspace-p2p-spike` findings. Read-only: this document changes no
> code and merges no PRs. It records findings, verdicts, decisions the
> maintainer must make, and an apply-ready patch appendix.

## 0. Executive summary

The format is close to 1.0-ready **as a specification**. The schema
vocabulary is settled (rich enums, format tokens, relations with
cardinality, reserved computed fields), the addressing grammar is
stable, the view model is coherent, and the storage/sync posture is
now written down. The reference library implements the core read/query
path faithfully.

Three things stand between here and a defensible 1.0:

1. **The corpus has never been read as a merged whole.** Six of the
   defining documents live across seven unmerged PRs. Reading the
   post-merge overlay surfaces one genuine cross-document contradiction
   (the access model, section C) and a handful of stale cross-references
   — all fixable in text.
2. **Three reference-implementation defects** undercut the format's own
   promises (line-diffable, git-friendly, local-first, sync-ready):
   id-vs-filesystem case collision, non-atomic writes, and a fail-fast
   parser. None are hard to fix; all are filed (section E).
3. **Two decisions only the maintainer can make**: the access model
   (section C) and `schema-version` convergence under sync (section D3).

Verdict: **1.0-ready in shape; not yet in substance.** The spec can be
frozen once section C is decided and the section E defects have a plan.
The defects are pre-1.0-appropriate (no production data exists yet).

Numbers below reference filed issues **#42–#46** and open PRs
**#24, #26, #29, #30, #39, #40, #41**.

## A. Merge state and recommended order

Seven PRs are open. They fall into two non-overlapping clusters plus
two standalone docs.

### Collision matrix (files touched by more than one open PR)

| File | PRs | Cluster |
|---|---|---|
| `docs/SPEC.md` | #39, #40, #41 | docs/core |
| `docs/DECISIONS.md` | #39, #40 | docs/core |
| `docs/ARCHITECTURE.md` | #39, #41, #29 | docs/core + UI |
| `packages/core/src/index.ts` | #39, #40, #41 | docs/core |
| `packages/ui/src/views.tsx` | #29, #24 | UI |
| `packages/ui/src/internal/PortalHost.tsx` | #29, #24 | UI |
| `apps/desktop/App.tsx`, `apps/mobile/App.tsx` | #29, #24 | UI |

`docs/prior-art` (#30) and `docs/permissions` (#26) each add a single
new file and collide with nothing.

### Recommended order

1. **#39 → #40 → #41, in that order, rebasing each on the last.** All
   three edit `SPEC.md` and `index.ts`; #39 and #40 both edit
   `DECISIONS.md`. The D-numbering was deliberately partitioned to make
   this work (D15–D17 reserved by #39, D18–D21 by #40 — verified
   non-overlapping), but the three PRs still append to the same files,
   so a linear rebase chain avoids three-way conflicts. Each rebase is
   mechanical (append-only, disjoint sections).
2. **#30 and #26 anytime** — zero collisions. Note the access-model
   decision (section C) should land in or alongside #30/#26, since it
   changes wording in both PRIOR-ART and PERMISSIONS.
3. **#29, then #24** — but first confirm **#24 is superseded** (see B5).
   If it is, close it and #29 merges cleanly; the UI-cluster collisions
   vanish.

After the docs/core chain lands, apply the section-F patch appendix
(the alignment edits could not be applied pre-merge without hitting
stale files or manufacturing conflicts — see the note in section F).

## B. Consistency audit (documentation)

### B1. Claims-vs-code — reference functions cited in the spec

Every "reference: `X()` in `@workspace.sh/table-core`" in the merged
spec was checked against source. All exist and match their described
behaviour:

- `enumOptions()` / `enumValues()` — present (`types.ts`), normalise
  string-or-object enums; validator and both sort/group sites route
  through them. ✓
- `formatValue()` / `stringFormatKind()` — present (`format.ts`),
  closed vocabulary, `Intl`-backed, never throws. ✓
- `fromCSV` / `toCSV` / `csvExportWarnings()` — present (`csv.ts`),
  RFC 4180, lossy-export warnings surfaced. ✓
- `parseAddress` / `formatAddress` / `resolveRow` — present
  (`address.ts`). ✓

One asymmetry (filed **#46**): SPEC section 6 says "the reader resolves
under `attachments/`", but the reference parser reads `bodies/` and
**never touches `attachments/`**. Either core should gain an attachment
resolver (parallel to `readBodies`) or SPEC section 6 should say
resolution is the app's concern (as relations already are). Low
severity; alignment item.

### B2. Cross-document contradiction hunt

One material contradiction — the access model — gets its own section
(**C**). Otherwise the corpus is coherent. Minor items:

- STORAGE-AND-SYNC and DECISIONS D17 both commit to per-field
  last-writer-wins; consistent. The `schema-version` convergence gap
  under that model is real but is a *missing* rule, not a
  contradiction (section D3, filed **#45**).
- PRIOR-ART's "no private layer" vs PERMISSIONS' `x-tier` is the one
  true contradiction (section C).

### B3. DECISIONS numbering

develop carries D1–D14. #39 adds D15–D17 (storage/sync). #40 adds
D18–D21 (vocabulary). No overlap; the blind cross-branch partition
held. After both merge, D1–D21 is contiguous. The forward-reference in
#40's SPEC ("Computed fields … see DECISIONS D21") resolves correctly
post-merge. ✓ No action.

### B4. PRIOR-ART refresh list

PRIOR-ART.md (#30) predates issues #31–#35 and PRs #40/#41, so its gap
list says "no issue yet" for items that now exist. Apply-ready edits in
section F. Mapping:

| PRIOR-ART gap item | Now tracked by |
|---|---|
| Computed / formula fields | #34 (issue) + reserved in #40 (D21) |
| Multi-target relations (`cardinality`) | #35 (issue) + implemented in #40 |
| Per-enum color/label, number/date/string `format`, field `description`/`icon` | #31/#32/#33 + implemented in #40 |
| Rich text in a cell (`format: "markdown"`) | shipped (pre-existing) + #32 |
| Revision history (`history.ndjson`) | #10 (already cited) |
| CSV converter | #5 → implemented in #41 |
| Rust reference core | #19 (already cited) |

### B5. PR #24 supersession

**#28 (drag-and-drop on macOS + iOS via PanResponder + PortalHost) is
merged to develop** (commit `e5c5948`). **#24 is still open** with the
title "drag-drop parity on iOS + macOS" — the same subject. #24 also
touches an earlier `DragPressable.ts` primitive that the merged #28
approach (RNGH-based, per #29) has moved past. **Recommendation:**
verify #24 carries nothing unique, then close it. This removes every
UI-cluster collision except #29's own.

## C. The access model — decision required

This is the one genuine cross-document contradiction, and it is the
maintainer's call, not a mechanical fix.

### The tension

**PRIOR-ART.md** (#30) states the format's thesis (maintainer's
explicitly-held stance):

> "`.table/` has **no private layer**. Anything written into it is
> visible to every consumer authorized to read it; there's no per-user
> state hidden alongside the rows."

**PERMISSIONS.md** (#26) proposes field-level encryption tiers:

> "A peer without `K2` replicates all blocks … but decrypts only the
> fields their keys cover. The `schema.json` is unencrypted so every
> peer knows which fields exist and which tier they belong to, even
> when they cannot read the values."

Fields tagged `x-tier` in `schema.json` are encrypted so that some
authorised org members **cannot read** them. Taken literally, that is
exactly the "private layer" PRIOR-ART says the format does not have.

### Analysis

The two documents are using "authorised" at different granularities.
PRIOR-ART is making a **format-shape** claim: there is no hidden
*per-user application state* (column widths, pinned views, cursor
position) smuggled into the data file — those live outside the
`.table/`. PERMISSIONS is making an **access-control** claim:
authorisation can be scoped per-field, not just per-table.

These are reconcilable **if** "no private layer" is read as "no hidden
per-user *state*", and `x-tier` is read as "authorisation
*granularity*" — a reader either holds the key for a field or does not,
and if they hold it they see exactly what every other key-holder sees.
There is still no per-user *divergent* view of the same field; there is
per-field *access*. That preserves PRIOR-ART's real point (the data is
not a bag of per-user secrets) while allowing PERMISSIONS' model.

But this reconciliation is not free: under `x-tier`, two authorised org
members genuinely see **different data** from the same `.table/`. If
the maintainer's stance is the stronger "anything an authorised
consumer can open, they can fully read", then `x-tier` field-hiding
contradicts it and PERMISSIONS needs rework toward whole-table access
(you hold the table key or you do not).

### The three framings (maintainer chooses)

1. **Reconcile (recommended).** "No private layer" = no hidden per-user
   *state*; `x-tier` = per-field *authorisation*. Both docs stand, with
   wording changes so neither overclaims. PRIOR-ART adds a sentence
   distinguishing per-user *state* (never in the file) from per-field
   *access* (a permissions concern, out of format scope). PERMISSIONS
   adds a sentence stating that within a tier all key-holders see
   identical data — there is no per-user divergence, only per-field
   access. Exact wording in section F.
2. **No-private-layer wins.** Field-level hiding contradicts the
   thesis; PERMISSIONS is revised toward whole-table access control and
   `x-tier` is dropped or demoted to a non-format-level concern. Flag
   #26 for rework.
3. **Defer.** Record the tension as an open decision in both PRs;
   neither ships wording that resolves it until the maintainer rules.
   Cheapest now; leaves the corpus internally contradictory until
   resolved, so not recommended as an end state.

The section F appendix carries the reconciliation wording for framing 1
(the recommended path); if framing 2 or 3 is chosen, that wording is
not applied.

## D. Feasibility interrogation

Each load-bearing assumption, pressure-tested, with a verdict.

### D1. Row id vs case-insensitive filesystems — **at-risk** (filed #42)

`newId()` returns a default `nanoid` (`A-Za-z0-9_-`, case-sensitive);
ids become filenames (`bodies/{id}.md`). On case-insensitive
filesystems (default APFS, NTFS, many sync targets) two ids differing
only in case map to the same path → silent body overwrite on write, or
wrong body on read. Git on a case-insensitive checkout inherits it.
Not an entropy problem — a case-folding problem. Fails silently with
data loss (worst mode). Fix options in #42; recommended is a case-safe
alphabet with a length bump to preserve entropy. Breaking for existing
ids, which is acceptable pre-1.0.

### D2. Write atomicity / torn reads — **at-risk** (filed #43)

`writer.ts` writes files in place, sequentially, no temp+rename, no
fsync, no recovery. A crash, a concurrent reader, or a file-sync client
(iCloud/Dropbox) can observe or propagate a `.table/` with a new
`schema.json` and an old `rows.ndjson`. `bodies/` is delete-then-
rewrite, so a mid-write crash can leave bodies deleted-not-rewritten.
This compounds D4 (strict parser): a torn write is exactly the
malformed input the parser hard-fails on. PR #39 already prescribes
temp+rename for `index.sqlite`; the canonical text files — which matter
more — get no such treatment. Recommended: temp+rename per file (or a
staged sibling-dir swap for full-directory atomicity), document the
writer atomicity contract in SPEC.

### D3. `schema-version` under multi-writer sync — **needs-decision** (filed #45)

`schema-version` is a monotonic counter. Two offline peers at v1 can
both bump to v2 with *different* schemas; on sync there are two
distinct "v2"s and the number lies. D17's op-log model doesn't state
how it converges. The append-only schema rule (D18) makes most
concurrent schema edits commute, which is why this is tractable — but
the version *number* still needs a convergence rule (content-hash,
log-position-wins, or explicitly single-writer-only). Maintainer's
call; options in #45.

### D4. Parser fail-fast posture — **needs-decision** (filed #44)

`parseTable` throws on one malformed NDJSON line, on a row missing
`id`, and on a missing/malformed `schema.json`. For a format sold as
hand-editable, line-diffable, git-friendly text, a single typo or a
merge-conflict marker makes the whole table unreadable. Decide fail-
fast (current) vs skip-and-collect (recommended: parse valid rows,
return per-line diagnostics like `ValidationError`), then state it in
SPEC as the reader contract. Interacts with D2.

### D5. Directory-as-file on real platforms — **sound, with caveats**

The `.app`-style directory-is-a-file model works, but the corpus should
acknowledge platform realities: macOS package/bundle semantics
(needs the right UTI/extension handling to present as one item), iOS
Files / file-provider (directory documents are second-class vs flat
files), Android SAF (tree-URI access, not path access), zip/email
round-trips (directory survives as a folder, not a single attachment
unless zipped), and case-insensitive git checkouts (feeds D1). None is
a blocker; all deserve a short "platform notes" acknowledgement so the
"a directory that IS a file" claim isn't read as frictionless
everywhere. Recommend a brief note in ARCHITECTURE or SPEC.

### D6. Sync stress-walk — **sound where committed, one honest gap**

Walking concurrent-edit scenarios against the D17 model:
- Concurrent field-add / enum-add: commute (set union). ✓ (D18 is
  load-bearing here, correctly identified.)
- Concurrent **enum reorder**: does **not** commute — the spec already
  admits this and makes it a `schema-version` bump (which then hits
  D3). Consistent, but the D3 gap is the tail of this thread.
- Per-field LWW vs a concurrent **row delete**: LWW on fields assumes
  the row exists; delete-vs-update needs a tombstone rule the model
  doesn't yet state. Worth a sentence in STORAGE-AND-SYNC.
- **Bodies** are prose, not LWW-able — STORAGE-AND-SYNC already flags
  this as needing real text merge (separate tooling). ✓ honest.
- Attachments as content-addressed blobs: fine, and D7's filename-only
  convention accommodates it. ✓
Net: the model is sound where it commits; the two thin spots
(row-delete tombstones, and D3) should be named rather than left
implicit.

### D7. Scale envelope — **sound**

STORAGE-AND-SYNC's numbers hold: 100k rows ≈ 50MB NDJSON, sub-second
parse, SQLite well within limits, Airtable/Notion as calibration
anchors. The plain-text full-rewrite-per-save (D2's writer) is the real
ceiling, and the doc already says so ("the text layer bottlenecks
first"). No correction needed.

## E. Defect register

| # | Issue | Verdict | Severity |
|---|---|---|---|
| #42 | Row id case-collision on case-insensitive filesystems | at-risk | high (silent data loss) |
| #43 | Writer has no atomicity — torn `.table/` on crash/concurrent read | at-risk | high |
| #44 | Parser fail-fast — one bad line loses the table | needs-decision | medium |
| #45 | `schema-version` undefined under multi-writer sync | needs-decision | medium (design) |
| #46 | Reference core reads `bodies/` but not `attachments/` | alignment | low |

All five are self-contained and executable cold by a later model.
#42/#43 are the two that most directly undercut the format's promises
and should be scheduled first.

## F. Apply-ready patch appendix

These are the non-contentious alignment edits. **They are documented
here rather than applied, because every file they touch lives on an
unmerged branch** (PRIOR-ART on #30, the new SPEC/DECISIONS on
#39/#40); patching now would hit stale files on develop or manufacture
conflicts with the very PRs under review. Apply after the relevant PR
merges.

1. **PRIOR-ART.md (#30) — issue-reference refresh.** Update the gaps
   section per the B4 mapping: computed → #34/D21, cardinality →
   #35 (shipped), enum/format/icon → #31/#32/#33 (shipped), CSV → #5
   (shipped in #41). Change "no issue yet" / "worth doing as its own
   PR" notes to the now-real issue and PR numbers.

2. **Access-model reconciliation (framing 1 only — needs maintainer
   sign-off from section C).**
   - PRIOR-ART.md, after the "no private layer" paragraph, add: "'No
     private layer' refers to per-user *state* — there is no hidden,
     per-user divergent view of the data. Per-field *access control*
     (see docs/PERMISSIONS.md) is a separate concern: a reader either
     holds a field's key or does not, and all key-holders for a field
     see identical values. Access granularity is not the same as hidden
     state."
   - PERMISSIONS.md, near the `x-tier` description, add: "Within a
     tier, every key-holder sees identical data — `x-tier` scopes
     *access*, not a per-user *view*. This is consistent with
     `.table/`'s 'no private layer' stance (docs/PRIOR-ART.md): the
     format carries no hidden per-user state, only per-field access."

3. **SPEC section 6 / #46** — once decided, either add the attachment
   resolver note (core loads it) or soften "the reader resolves under
   `attachments/`" to "resolution is the consuming app's concern",
   matching the reference implementation.

4. **Platform notes (D5)** — add a short "platform realities"
   paragraph to ARCHITECTURE (or SPEC section 1) acknowledging macOS
   bundle / iOS file-provider / Android SAF / zip-for-transport /
   case-insensitive-checkout caveats to the "directory that IS a file"
   claim.

## G. Conclusion — 1.0 readiness

**Freeze-blockers (must resolve before calling the spec 1.0):**
- Decide the access model (section C). Until then two shipped docs
  contradict each other.
- Decide `schema-version` convergence (#45) — the sync story is
  otherwise underspecified at a load-bearing point.

**Should-fix before 1.0 (undercut stated promises, but mechanical):**
- #42 id case-collision, #43 writer atomicity. Both are "the format
  claims X; the reference implementation doesn't deliver X" gaps.

**Can follow 1.0:**
- #44 parser posture (decide, then implement), #46 attachments
  alignment, D5 platform notes, D6 tombstone wording.

**Already sound, no action:** D-numbering, claims-vs-code (bar #46),
scale envelope, the vocabulary and addressing models, the merge-order
mechanics.

Once section C is decided and #42/#43/#45 have owners, the spec is
defensible to freeze. The reference implementation follows.
