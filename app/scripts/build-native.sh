#!/usr/bin/env bash
# Builds the native macOS helper (app/native/rivertide-helper) as a universal arm64 + x86_64
# binary from app/native/rivertide-helper.swift. Needs only the Command Line Tools (swiftc, lipo).
#
# Compiled in Swift 5 language mode (-swift-version 5) on purpose: the helper is a small
# single-file CLI with process-wide state and a C event-tap callback, coordinated explicitly with
# DispatchQueues. Swift 6 strict-concurrency checking flags that pattern (only a warning today with
# Swift 6.3), and a future toolchain must never be able to turn it into a broken build.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "skipping native helper (macOS only)"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$SCRIPT_DIR/../native" && pwd)"
SOURCE="$NATIVE_DIR/rivertide-helper.swift"
BUILD_DIR="$NATIVE_DIR/build"
OUTPUT="$NATIVE_DIR/rivertide-helper"
MIN_MACOS="13.0"
ARCHS=(arm64 x86_64)

mkdir -p "$BUILD_DIR"

slices=()
for arch in "${ARCHS[@]}"; do
  slice="$BUILD_DIR/rivertide-helper-$arch"
  echo "compiling rivertide-helper for $arch (macOS $MIN_MACOS+)"
  swiftc -O -swift-version 5 \
    -target "$arch-apple-macos$MIN_MACOS" \
    -o "$slice" \
    "$SOURCE"
  slices+=("$slice")
done

lipo -create -output "$OUTPUT" "${slices[@]}"
chmod +x "$OUTPUT"
echo "built $OUTPUT ($(lipo -archs "$OUTPUT"))"
