#!/bin/sh
# Build the native Node binding (N-API) for this machine into native/.
# Linux first; other platforms build the same crate on their own machines.
set -eu
cd "$(dirname "$0")/.."
cargo build --release -p workspace-edn-node
platform=$(node -p 'process.platform + "-" + process.arch')
mkdir -p js/native
cp target/release/libworkspace_edn_node.so "js/native/edn.$platform.node"
echo "js/native/edn.$platform.node"
