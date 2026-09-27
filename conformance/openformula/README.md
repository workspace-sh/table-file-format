# OpenFormula conformance suite

What `.table` formulas mean is fixed to OpenFormula (ODF 1.4 Part 4,
DECISIONS D38). This directory holds public test cases for it, written
in the stored form of SPEC section 2, so any `.table` client can check
itself against the same answers.

- [`functions.txt`](functions.txt): OpenFormula's functions, taken
  from the spec's own section 6 headings.
- [`libreoffice/`](libreoffice/): cases imported from LibreOffice's
  function tests, one file per test file, with the cell each case came
  from. Mozilla Public License 2.0 ([`LICENSE`](libreoffice/LICENSE));
  the commit is in [`SOURCE.json`](libreoffice/SOURCE.json).
- [`REPORT.md`](REPORT.md): what each engine meets, per function.

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
- Numbers compare as LibreOffice's `=` does, to within 2^-48 of each
  other, unless the case carries `:round N` (both rounded to N
  decimals) or `:sig N` (N significant digits), as the source's own
  check did. `true` and `false` equal 1 and 0 (OpenFormula 4.3.7).
- Dates and times are numbers: days since 1899-12-30, the default null
  date (OpenFormula 4.3.2).

## Running it

```sh
npm run run -w @workspace.sh/table-conformance
```

This rewrites `REPORT.md`. The engines are in
`packages/conformance/src/engines.ts`.

## Importing

The importer reads OpenFormula's formula text with its own reader,
written to the spec's grammar. It doesn't borrow an engine's reading,
since the suite is what measures engines.

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/LibreOffice/core.git
git -C core sparse-checkout set sc/qa/unit/data/functions
npm run import:libreoffice -w @workspace.sh/table-conformance -- core
npm run list:functions -w @workspace.sh/table-conformance
```

**Not imported yet** (counts in `SOURCE.json`): cases whose formula
reads other cells, which need those inputs carried with the case; cases
with an error literal or a named expression in the formula; and cases
whose check the importer doesn't read yet.
