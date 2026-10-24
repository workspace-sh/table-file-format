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
| Web | WebAssembly (`js/`) | Built; the corpus passes in Firefox |
| Linux (Node, GTKX) | WebAssembly (`js/`) | Built; the corpus passes in Node |
| macOS, iOS (Hermes) | C interface → JSI | To do: Hermes has no WebAssembly |
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

Whole bundles go in once (row ids, stored columns, formulas, relations) and
every formula column comes out once. Same results as `.table`'s workbook
(`computeRows`), value for value and message for message: every fixture
bundle, deliberately awkward values, and relations gone wrong
(`js/src/evaluate.test.ts`). 21 of the fixtures' 22 formulas are the core's;
the one reading a Sheet place (`at`) stays with `.table`'s workbook.

Cells' own formulas (D52), with the same type check a typed value gets,
loops worked out by iteration (D60), and the clock and chance (`today`,
`now`, `rand`, D55) are the core's too. The host gives the one moment
(its own date, and the instant in UTC) and a seed for chance. A host that
gives no moment leaves a table reading the clock to its own evaluator, and
so does a cell's formula in a GeoJSON field. Either way every table
related to it goes with it (by a relation or a `linked`): a value read
across from the host's table has to be the host's.

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
- **Size:** WebAssembly 268 KB, 99 KB gzipped (speed build). The
  arbitrary-precision numbers are about 68 KB of it, and recoverable.
- **Large single inputs** (9.7 MB, 100,000 maps): natively under a second,
  through WebAssembly about 3.8 s. Not profiled yet.
