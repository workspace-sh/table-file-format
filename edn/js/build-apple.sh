#!/bin/sh
# Build the core's C binding (edn/crates/ffi) for the iOS and Mac apps into
# apple/WorkspaceEdnCore.xcframework: the iPhone, the simulator, and the Mac,
# Apple silicon only: no Intel slice. Runs on a Mac with Xcode and rustup.
set -eu
cd "$(dirname "$0")/.."
targets="aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin"
rustup target add $targets
for t in $targets; do
  cargo build --release -p workspace-edn-ffi --lib --target "$t"
done
lib=libworkspace_edn_ffi.dylib
name=WorkspaceEdnCore
out=js/apple/build
rm -rf "$out" js/apple/WorkspaceEdn.xcframework "js/apple/$name.xcframework"
mkdir -p "$out"

# A dynamic framework, not a static library: each Rust static library carries
# its own copy of Rust's runtime, so an app that links two (Workspace links
# the Markdown editor's as well) fails on duplicate symbols, and hiding one
# copy leaves more personality routines than the Mac's compact unwind
# encodes. A framework keeps its runtime and its unwind tables to itself.
plist() { # <path> <platform>
  cat > "$1" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>sh.workspace.edn.core</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleSupportedPlatforms</key><array><string>$2</string></array>
  <key>MinimumOSVersion</key><string>26.0</string>
</dict></plist>
PLIST
}
flat() { # <dir> <binary> <platform>: an iOS framework
  f="$1/$name.framework"
  mkdir -p "$f/Headers"
  cp "$2" "$f/$name"
  install_name_tool -id "@rpath/$name.framework/$name" "$f/$name"
  cp crates/ffi/include/workspace_edn.h "$f/Headers/"
  plist "$f/Info.plist" "$3"
}
versioned() { # <dir> <binary>: a Mac framework
  f="$1/$name.framework"
  mkdir -p "$f/Versions/A/Headers" "$f/Versions/A/Resources"
  cp "$2" "$f/Versions/A/$name"
  install_name_tool -id "@rpath/$name.framework/Versions/A/$name" "$f/Versions/A/$name"
  cp crates/ffi/include/workspace_edn.h "$f/Versions/A/Headers/"
  plist "$f/Versions/A/Resources/Info.plist" MacOSX
  ln -s A "$f/Versions/Current"
  ln -s "Versions/Current/$name" "$f/$name"
  ln -s Versions/Current/Headers "$f/Headers"
  ln -s Versions/Current/Resources "$f/Resources"
}
flat "$out/ios" "target/aarch64-apple-ios/release/$lib" iPhoneOS
flat "$out/ios-sim" "target/aarch64-apple-ios-sim/release/$lib" iPhoneSimulator
versioned "$out/mac" "target/aarch64-apple-darwin/release/$lib"
xcodebuild -create-xcframework \
  -framework "$out/ios/$name.framework" \
  -framework "$out/ios-sim/$name.framework" \
  -framework "$out/mac/$name.framework" \
  -output "js/apple/$name.xcframework"
rm -rf "$out"
echo "js/apple/$name.xcframework"
