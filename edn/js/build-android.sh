#!/usr/bin/env bash
# Build the core's C binding (edn/crates/ffi) for the Android apps: one .so
# per ABI in android/src/main/jniLibs, which android/CMakeLists.txt links and
# Gradle packages. The counterpart of build-apple.sh: prebuilt, so an app
# build needs no Rust. Every ABI an app may build, since one built without
# its .so fails to load on exactly those devices.
#
# Needs an NDK (ANDROID_NDK_HOME, or the newest under $ANDROID_HOME/ndk) and
# the four Rust targets; the script names any that are missing.
set -euo pipefail
cd "$(dirname "$0")/.."

# minSdk in android/build.gradle.
API=24

NDK="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK" ]; then
  SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  [ -d "$SDK" ] || SDK="$HOME/Android/Sdk"
  NDK="$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
  echo "No NDK found. Set ANDROID_NDK_HOME, or install one with the SDK manager." >&2
  exit 2
fi
case "$(uname -s)" in
  Darwin) HOST_TAG="darwin-x86_64" ;;
  Linux)  HOST_TAG="linux-x86_64" ;;
  *) echo "Unsupported host: $(uname -s)" >&2; exit 2 ;;
esac
BIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"

TARGETS=(
  "aarch64-linux-android:arm64-v8a"
  "armv7-linux-androideabi:armeabi-v7a"
  "x86_64-linux-android:x86_64"
  "i686-linux-android:x86"
)

rustlib="$(rustc --print sysroot)/lib/rustlib"
missing=()
for entry in "${TARGETS[@]}"; do
  [ -d "$rustlib/${entry%%:*}" ] || missing+=("${entry%%:*}")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing Rust targets: ${missing[*]}" >&2
  echo "  rustup target add ${missing[*]}" >&2
  exit 2
fi

lib=libworkspace_edn_ffi.so
for entry in "${TARGETS[@]}"; do
  triple="${entry%%:*}"
  abi="${entry##*:}"
  upper="$(echo "$triple" | tr 'a-z-' 'A-Z_')"
  # The armv7 compiler is named armv7a-…; every other one matches its triple.
  case "$triple" in
    armv7-linux-androideabi) clang="$BIN/armv7a-linux-androideabi${API}-clang" ;;
    *) clang="$BIN/${triple}${API}-clang" ;;
  esac
  [ -x "$clang" ] || { echo "No compiler at $clang: is the NDK complete?" >&2; exit 2; }
  # -soname: a Rust cdylib has none, so the library linking it would record
  # the path it was linked from, and fail to load on the device.
  # max-page-size=16384: Android 15 devices may use 16 KB pages.
  env \
    "CARGO_TARGET_${upper}_LINKER=$clang" \
    "CC_${triple//-/_}=$clang" \
    "AR_${triple//-/_}=$BIN/llvm-ar" \
    RUSTFLAGS="-C link-arg=-Wl,-soname,$lib -C link-arg=-Wl,-z,max-page-size=16384" \
    cargo build --release -p workspace-edn-ffi --lib --target "$triple"
  mkdir -p "js/android/src/main/jniLibs/$abi"
  cp "target/$triple/release/$lib" "js/android/src/main/jniLibs/$abi/"
  echo "js/android/src/main/jniLibs/$abi/$lib"
done
