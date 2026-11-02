#!/bin/sh
# Build the native Node binding (N-API) for this machine, into native/ or the
# folder named. Each machine builds its own: an app's build runs this, so every
# chip it's built on has its engine.
set -eu
out=$(realpath -m "${1:-$(dirname "$0")/native}")
cd "$(dirname "$0")/.."
cargo build --release -p workspace-edn-node
platform=$(node -p 'process.platform + "-" + process.arch')
mkdir -p "$out"
cp target/release/libworkspace_edn_node.so "$out/edn.$platform.node"
echo "$out/edn.$platform.node"
