#!/bin/sh
# The Rust sources the bindings are built from, as one hash. build-wasm.sh and
# build-native.sh write it beside what they build (wasm/edn.source,
# native/edn.<platform>-<arch>.node.source), and CI fails when a committed
# binary's stamp isn't the sources' (.github/workflows/checks.yml), so a change
# to the Rust can't land with a binary built before it. Hashes the files as
# they are on disk, committed or not.
set -eu
cd "$(dirname "$0")/.."
git ls-files --cached --others --exclude-standard -- Cargo.toml Cargo.lock crates | LC_ALL=C sort | while IFS= read -r f; do
  if [ -f "$f" ]; then printf '%s %s\n' "$(git hash-object "$f")" "$f"; fi
done | git hash-object --stdin
