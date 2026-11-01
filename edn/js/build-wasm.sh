#!/bin/sh
# Build the WebAssembly binding from edn/crates/wasm into wasm/.
# Needs Rust with the wasm32-unknown-unknown target, wasm-bindgen 0.2.121
# (matching the crate) and binaryen's wasm-opt.
set -eu
cd "$(dirname "$0")/.."
cargo build --release -p workspace-edn-wasm --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir js/wasm --out-name edn target/wasm32-unknown-unknown/release/workspace_edn_wasm.wasm
wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int -o js/wasm/edn_bg.wasm js/wasm/edn_bg.wasm
