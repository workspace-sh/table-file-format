# OpenFormula conformance suite

What `.table` formulas mean is fixed to OpenFormula (ODF 1.4 Part 4,
DECISIONS D38). This directory holds public test cases for it, written
in the stored form of SPEC section 2, so any `.table` client can check
itself against the same answers.

- [`functions.txt`](functions.txt): OpenFormula's functions, taken
  from the spec's own section 6 headings.
- [`libreoffice/`](libreoffice/): the cases, imported from LibreOffice's
  function tests (below).
- [`REPORT.md`](REPORT.md): what each engine meets, per function.

## Where the cases come from

Every case names its source file and the cell it came from. There is
one source today.

### LibreOffice's function tests (included)

- **What:** the spreadsheet files LibreOffice tests its own functions
  with, one per function, in
  [LibreOffice/core `sc/qa/unit/data/functions/*/fods/`](https://github.com/LibreOffice/core/tree/master/sc/qa/unit/data/functions).
  Imported at commit `a8b4e7c698c81371f83228f77d166718e1eea7e3`
  ([`SOURCE.json`](libreoffice/SOURCE.json)).
- **Their layout:** each file's sheets have the columns *Function*
  (the formula), *Expected*, *Correct* (a check that the two agree) and
  *FunctionString*. LibreOffice's test,
  [`sc/qa/unit/functions_test.cxx`](https://github.com/LibreOffice/core/blob/master/sc/qa/unit/functions_test.cxx),
  opens each file, recalculates it, and fails if any *Correct* cell
  isn't 1.
- **Who wrote the expected answers:** of the 12,057 rows with a formula,
  11,062 expected answers are values typed in by the test's authors,
  and 995 are formulas LibreOffice calculated when the file was saved.
  So the answers are LibreOffice's project's, and LibreOffice passes
  them. Nothing here says they were checked against Excel or any other
  application.
- **How a case compares:** as the file's own *Correct* check does:
  equal to within 2^-48, rounded to N decimals or N significant digits,
  or "is an error".
- **Licence:** the files carry no licence notice of their own.
  LibreOffice is made available under the
  [Mozilla Public License 2.0](https://www.libreoffice.org/about-us/licenses/),
  and the test code beside them states MPL-2.0, so the cases derived
  from them are kept under MPL-2.0 ([`LICENSE`](libreoffice/LICENSE)),
  apart from this repository's MIT code.
- **Imported:** 11,293 cases. Left out, with counts in `SOURCE.json`:
  formulas reading another sheet, a whole row or column, or more than
  2,000 cells; error literals and named expressions; checks the importer
  doesn't read yet.

### Considered, not included

None of these is in the suite. Each would need its own import and its
own entry above before it counts.

| Source | Where | Licence | Who wrote the expected answers | Status |
| --- | --- | --- | --- | --- |
| IronCalc's test workbooks | [ironcalc/IronCalc `xlsx/tests/calc_tests`](https://github.com/ironcalc/IronCalc/tree/main/xlsx/tests/calc_tests) | MIT or Apache-2.0 | **Unverified.** IronCalc's README says its tool checks "that IronCalc computes the same results as Excel on a particular file". Whether Excel saved the answers in these files hasn't been checked. | Not imported |
| ECMA-376 worked examples | [ECMA-376 Part 1, 5th edition (2016), section 18.17.7](https://ecma-international.org/publications-and-standards/standards/ecma-376/) | Ecma's published standard | The standard's authors: 885 examples across 354 functions. At least one is wrong (`networkdays.intl`, table-file-format#132). | Not imported |
| Formula.js tests | [formulajs/formulajs `test/`](https://github.com/formulajs/formulajs/tree/master/test) | MIT | Formula.js's authors, by hand | Not imported |

The OpenFormula specification itself (ODF 1.4 Part 4) contains no test
cases: it has one "Test Cases" heading, with nothing under it.

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

**Not imported yet** (counts in `SOURCE.json`): cases that read another
sheet, a whole row or column, or more than 2,000 cells; cases with an
error literal or a named expression in the formula; and cases whose
check the importer doesn't read yet.
