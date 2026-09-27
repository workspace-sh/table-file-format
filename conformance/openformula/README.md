# OpenFormula conformance suite

What `.table` formulas mean is fixed to OpenFormula (ODF 1.4 Part 4,
DECISIONS D38). This directory holds public test cases for it, written
in the stored form of SPEC section 2, so any `.table` client can check
itself against the same answers.

- [`functions.txt`](functions.txt): OpenFormula's functions, taken
  from the spec's own section 6 headings.

## Where the cases come from

There are no cases yet. The first import, from LibreOffice's function
tests, was removed on 27 September 2026: two of its 23 contributors have
no licence statement on record with The Document Foundation, so the set
couldn't be fully accounted for. A source is added here only once its
licence and the origin of its expected answers are verified, and it is
listed in SPEC section 2.

## A case

One per line:

```edn
{:expr (round 2.348 2) :expect 2.35 :from "Sheet2!A2"}
{:expr (sqrt 16.2) :expect 4.02492235949962 :round 12 :from "Sheet2!A2"}
{:expr (sqrt (- 16)) :expect {:error nil} :from "Sheet2!A3"}
```

- `:expr` is the formula in its stored form.
- `:expect` is a number, string or boolean; `[[…]]` for an array;
  `{:error "#N/A"}` for a particular error; `{:error nil}` for any
  error. An engine's `#NAME?` never counts as "any error": it means
  the engine doesn't know the function.
- Numbers compare as equal to within 2^-48 of each
  other, unless the case carries `:round N` (both rounded to N
  decimals) or `:sig N` (N significant digits), as the source's own
  check did. `true` and `false` equal 1 and 0 (OpenFormula 4.3.7).
- Dates and times are numbers: days since 1899-12-30, the default null
  date (OpenFormula 4.3.2).
- A formula that reads cells on its own sheet does so with
  `(ref "A1")` or `(ref "A1:B3")`, and the case carries those cells'
  values in `:cells {"A1" 1 "B2" "x"}`; a cell not listed is empty.
  `ref` is the suite's scaffolding for OpenFormula's references, not
  part of the stored form: how `.table`'s own references (`field`,
  `column`, `lookup`, `linked`) feed a function that takes a range is
  the engine's business (#124). The case's formula sits where it did
  in its source (`:from`), since `row()` and `column()` read that.
- A file may begin with the host settings its cases were written under
  (OpenFormula 3.4), `{:host {:case-sensitive true :whole-cell true
  :regex true :wildcards false}}`. `.table`'s own are Excel's
  (DECISIONS D39). When an engine misses a case written under other
  settings, and the case uses something those settings change
  (criteria, database functions, lookups, `search`, comparisons), the
  report counts it as inconclusive rather than missed.

## Running it

```sh
npm run run -w @workspace.sh/table-conformance
```

This rewrites `REPORT.md`. The engines are in
`packages/conformance/src/engines.ts`.
