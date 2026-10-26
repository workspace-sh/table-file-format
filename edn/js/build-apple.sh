#!/bin/sh
# Build the core's C binding (edn/crates/ffi) for the iOS and Mac apps into
# apple/WorkspaceEdn.xcframework: the iPhone, the simulator, and the Mac
# (Apple silicon and Intel). Runs on a Mac with Xcode and rustup.
set -eu
cd "$(dirname "$0")/.."
targets="aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin x86_64-apple-darwin"
rustup target add $targets
for t in $targets; do
  cargo build --release -p workspace-edn-ffi --lib --target "$t"
done
lib=libworkspace_edn_ffi.a
out=js/apple/build
rm -rf "$out" js/apple/WorkspaceEdn.xcframework
mkdir -p "$out/mac" "$out/headers"
lipo -create "target/aarch64-apple-darwin/release/$lib" "target/x86_64-apple-darwin/release/$lib" -output "$out/mac/$lib"
cp crates/ffi/include/workspace_edn.h "$out/headers/"
xcodebuild -create-xcframework \
  -library "target/aarch64-apple-ios/release/$lib" -headers "$out/headers" \
  -library "target/aarch64-apple-ios-sim/release/$lib" -headers "$out/headers" \
  -library "$out/mac/$lib" -headers "$out/headers" \
  -output js/apple/WorkspaceEdn.xcframework
rm -rf "$out"
echo js/apple/WorkspaceEdn.xcframework
