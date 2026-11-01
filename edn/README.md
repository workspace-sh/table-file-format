# EDN for Workspace

One EDN reader and one canonical printer, in Rust, shared by `.table`
formulas and Workspace actions (table-file-format#626, decided 21 Oct
2026). Built natively wherever a platform has a native runtime, and as
WebAssembly only where it doesn't.

```
edn/
  crates/
    core/   the value model, reading (clojure-reader, within our limits),
            the canonical printer, errors with line and column
    wasm/   the WebAssembly binding: web, and Node (Linux's app)
  js/       @workspace.sh/edn: one TypeScript API over the WebAssembly
  corpus/   cases.json: input → canonical form, or the error expected.
            Every binding runs it.
```

## Where it runs

| Platform | Binding | Status |
| --- | --- | --- |
| Web | WebAssembly (`js/`) | Works out the web app's formulas once loaded (Firefox checked) |
| Linux (Node, GTKX) | Native (N-API, `js/native/`) | Works out the Linux app's formulas |
| macOS, iOS (Hermes) | C interface (`crates/ffi`) → JSI (`js/apple`, `@workspace.sh/edn/jsi`) | Built and tested on Linux through C and Node; the apps load it, but no Mac build has run yet |
| Android | C interface → JSI | To do |
| Bare | native addon over the C interface | To do |

## The canonical form

EDN defines none, so this does. The same value always prints to the same
bytes:

- one space between items, none inside brackets, no commas;
- map entries and set members in the byte order of their printed form;
- integers in decimal (`N` past 64 bits); floats in the shortest form that
  reads back the same, always with a `.` or an exponent (`1.0`); decimals
  with `M`; `##NaN`, `##Inf`, `##-Inf`;
- strings with `\"`, `\\`, `\n`, `\t` and `\r` escaped, other control
  characters as `\uXXXX`;
- characters by name where EDN has one (`\newline`, `\space`, `\tab`,
  `\return`).

Refused: ratios (`1/2`, Clojure's, not EDN), duplicate map keys and set
members, more than one value, nesting past 256, texts past 16 MB.

## Building and testing

```sh
cargo test -p workspace-edn                 # the core and the corpus
(cd js && sh build-wasm.sh)                 # needs the wasm32 target,
                                            # wasm-bindgen 0.2.121, wasm-opt
node --import tsx --test js/src/*.test.ts   # the corpus through WebAssembly
(cd js && sh build-apple.sh)                # on a Mac: the C binding for iOS and the Mac,
                                            # into js/apple/WorkspaceEdn.xcframework
cargo run --release -p workspace-edn --example big   # timing, 100,000 maps
python3 bench/formulas.py /tmp && cargo run --release -p workspace-edn --example many -- /tmp/formulas-250k.json
```

The built WebAssembly is committed in `js/wasm/`, so the web and Linux
apps don't need Rust to build.

## Measured (21 Oct 2026, the rig)

The north star is a table of 1,000,000 rows where up to a quarter of them
have a formula of their own: 250,000 distinct formulas. Read once each
(`examples/many.rs`, and the same list through the TypeScript reader
`.table` uses today):

| | 250,000 formulas | Against today |
| --- | --- | --- |
| Today: `table-expr-v1` TypeScript reader (Node) | 1.25 s | — |
| This core, native | 0.49 s | 2.5× faster |
| This core, WebAssembly, canonical text out | 1.37 s | about the same |
| This core, WebAssembly, tree into JavaScript | 2.24 s | 1.8× slower |

### Formulas computed inside the core

Whole bundles go in once (row ids, stored columns, formulas, relations,
Sheet views) and every formula column comes out once. It is `.table`'s
only evaluator (#710): table-core's `computeRows` and `sheetGrid` hand it
the tables (`setFormulaEngine`), and every package's tests run with it
(`--import ../../edn/js/src/node-engine.ts`). Until #710 there was also a
TypeScript evaluator, and the two were compared value for value and message
for message; what it gave is kept in `js/src/expected.json.gz`, which
`js/src/evaluate.test.ts` checks the core against: every fixture bundle,
deliberately awkward values, relations gone wrong, objects and GeoJSON,
and Sheet places down 3,000-row grids. On the 11,293 OpenFormula
conformance cases the two answered alike, every one.

What the core works out: fields' formulas, cells' own (D52, with the type
check a typed value gets), loops by iteration (D60), the clock and chance
(D55: the app gives the moment and a seed), and Sheet places (D41: `at`,
`range`, `row`, `rows`, a long running total worked down its grid rather
than by recursion), and objects and GeoJSON (passed on, compared, read
as text as JavaScript reads them, and checked as a typed value is). A
binding is always given the moment (`@workspace.sh/edn` gives the time
it's asked), so nothing is left to anyone else.

100,000 deals pointing at 2,000 companies (a row formula, a lookup through
the relation, two rollups back), everything included (columns in, results
out):

| | Today (`computeRows`) | This core |
| --- | --- | --- |
| Native (N-API, Linux) | 295 ms | 215 ms |
| WebAssembly (Node) | 273 ms | 214 ms |

Inside the core it's about 80 ms natively; the rest is getting columns in
and results out.

### Reading formulas

- **Native** (Linux, and what macOS, iOS and Android will use) is faster
  than today. Not yet measured on a phone's ARM chip.
- **WebAssembly** is at parity for text, slower when whole trees cross into
  JavaScript. Evaluating inside the core (text in, results out) is meant to
  remove that crossing; until then the web keeps today's reader.
- **Size:** WebAssembly 539 KB, 198 KB gzipped (speed build, 25 Oct 2026,
  with the workbook and Sheet places; 268 KB and 99 KB when it only read
  EDN). The arbitrary-precision numbers are about 68 KB of it, and
  recoverable.
- **Large single inputs** (9.7 MB, 100,000 maps): natively under a second,
  through WebAssembly about 3.8 s. Not profiled yet.
