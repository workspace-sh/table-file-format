#!/bin/sh
# Build the native Node binding (N-API) for this machine, into native/ or the
# folder named. Each machine builds its own: an app's build runs this, so every
# chip it's built on has its engine.
#
# `--linux-x64` builds the committed linux-x64 one instead, from any machine,
# with cargo-zigbuild (`cargo install cargo-zigbuild`, and zig) against glibc
# 2.28, so it loads on older distributions too.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
target=""
if [ "${1:-}" = "--linux-x64" ]; then
  target=x86_64-unknown-linux-gnu
  shift
fi
out=${1:-$here/native}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$here/.."
# Dependencies' and the standard library's paths are written into the binary
# (their panic messages): name them /cargo and /rustc there, not this machine's.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$(rustc --print sysroot)=/rustc"
if [ -n "$target" ]; then
  cargo zigbuild --release -p workspace-edn-node --target "$target.2.28"
  built=target/$target/release/libworkspace_edn_node.so
  platform=linux-x64
else
  cargo build --release -p workspace-edn-node
  platform=$(node -p 'process.platform + "-" + process.arch')
  built=target/release/libworkspace_edn_node.so
  [ -f "$built" ] || built=target/release/libworkspace_edn_node.dylib
fi
cp "$built" "$out/edn.$platform.node"
sh "$here/source-stamp.sh" > "$out/edn.$platform.node.source"
echo "$out/edn.$platform.node"
