# Real EDN for formulas

**Status: backlog.** A plan, not a decision. Nothing here changes the format or any reader yet.

Computed fields are stored as `table-expr-v1` (DECISIONS D29): an S-expression grammar described as EDN-style, read by a small hand-written reader in [`packages/core/src/expr.ts`](../packages/core/src/expr.ts). It reads lists `(fn arg …)`, JSON-style numbers and strings, `true`, `false`, `nil`, and bare words as field names. It is not EDN. It has no keywords (`:status`), maps (`{…}`), vectors (`[…]`), sets, characters, comments or tagged values, and some of its bare words (`^`, for one) aren't legal EDN symbols.

This plan replaces it with a real EDN engine, built to the [edn-format specification](https://github.com/edn-format/edn), shared by every platform `.table` runs on.

## Why

- **One grammar, read the same everywhere:** a formula means the same on every reader, with no dialect drift between hand-written parsers.
- **Room to grow:** maps, vectors and keywords let formulas take structured arguments and options instead of positional ones.
- **A shared foundation:** other Workspace formats are expected to store expressions as EDN too. One engine serves all of them.

## The engine

One implementation, in Rust, in the shape the markdown library's core already uses (a core crate, a C interface, a WebAssembly binding):

```
edn/
  crates/
    core/   value model · reader · canonical printer · errors with positions
            (later: the formula evaluator)
    c/      stable C interface + generated header
    wasm/   wasm-bindgen binding
  js/       one TypeScript API, the same over the native and WebAssembly bindings
  corpus/   conformance cases: .edn input → expected value, error, or canonical output
```

### What the core defines

- **The whole EDN value model, without loss:**
  - nil, booleans, strings, characters;
  - integers (with arbitrary precision, `1N`) and floats (with arbitrary-precision decimals, `1.5M`), kept apart, so `1` and `1.0` stay different;
  - symbols and keywords, with namespaces;
  - lists, vectors, maps with any key, sets;
  - tagged values: `#inst` and `#uuid` built in, unknown tags kept as they are and never dropped.
- **A canonical printed form:** EDN doesn't define one. This specification would, so the same value always prints to the same bytes, for sync, diffs, hashes and signatures. It covers:
  - the order of map entries and set members;
  - number formats;
  - string escapes;
  - spacing.
- **Errors with line and column,** for editors to point at.
- **Limits** on nesting depth and size, so a hostile file can't exhaust memory.

### Platforms

Native wherever there's a native runtime; WebAssembly only where there isn't.

| Platform | Binding |
|---|---|
| iOS, macOS (React Native, Hermes) | C interface → JSI (Hermes has no WebAssembly) |
| Android | C interface → JSI |
| Linux (GTKX) | C interface, as a shared library loaded through GTKX's native bridge |
| Bare | native addon over the C interface |
| Web, web workers, Node tools | WebAssembly |

**The trade-off:** `table-core` is pure TypeScript today. Formulas through this engine give it a native dependency, packaged per platform, as the markdown library has.

### Testing

- **Shared corpus:** every binding runs the same corpus, so implementations can't drift apart. It's built from:
  - the EDN specification;
  - Clojure's reader as the reference behaviour;
  - known edge cases.
- **Property tests:** reading, printing and reading again gives the same value.
- **Fuzzing:** of the reader.
- **Real fixtures:** the formulas in `fixtures/` are read by both the current reader and the new one, and compared.

## Moving formulas over

- `table-expr-v1` texts mostly read as EDN already: `(sum price quantity)` and `(if (> total 4200) "over" "ok")` are valid EDN as they stand. The corpus records the exceptions.
- Real EDN formulas become `table-expr-v2`, through the `dialect` field D29 reserved for this, so `formatVersion` doesn't change.
- Readers keep reading `table-expr-v1` for as long as the format supports it.

## Order

1. Specify the value model and the canonical form, and write the corpus.
2. Build the core reader and printer, passing the corpus.
3. Build the WebAssembly binding and the TypeScript API (web, Node).
4. Build the C interface, JSI binding, Linux library and Bare addon.
5. Add `table-expr-v2`: the formula evaluator moves into the core.

Steps 1–4 change no behaviour on their own.

## Open

- Where the engine lives: its own repository, or with the format.
- Which existing Rust EDN crates, if any, to build on, after checking each against the corpus.
- Which tags beyond `#inst` and `#uuid` formulas may use.
