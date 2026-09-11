#!/bin/bash
# Builds DeepSeek Harness.app — a native macOS shell around `dsh web`.
#
# Requires only the Command Line Tools (swiftc). No Rust, no Xcode project,
# no package manager.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/DeepSeek Harness.app"
BIN_NAME="DeepSeekHarness"
MIN_MACOS="13.0"

echo "==> cleaning $BUILD"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> compiling (swiftc)"
# -swift-version 5 keeps the language mode stable regardless of the
# installed toolchain's default (Swift 6 strict concurrency would reject
# the AppKit delegate callbacks used here).
swiftc \
  -O \
  -swift-version 5 \
  -target "arm64-apple-macos$MIN_MACOS" \
  -framework AppKit \
  -framework WebKit \
  -framework AVFoundation \
  -framework Speech \
  -o "$APP/Contents/MacOS/$BIN_NAME" \
  "$HERE/Sources/main.swift" \
  "$HERE/Sources/SidebarActions.swift" \
  "$HERE/Sources/VoiceInput.swift" \
  "$HERE/Sources/ProjectPicker.swift"

echo "==> Info.plist"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"

echo "==> icon"
ICONSET="$BUILD/AppIcon.iconset"
LOGO="$HERE/Assets/deepseek-logo.svg"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
if [[ -f "$LOGO" ]]; then
  "$APP/Contents/MacOS/$BIN_NAME" --make-icon "$BUILD/icon-1024.png" "$LOGO"
else
  echo "    (no $LOGO — falling back to a wordmark tile)"
  "$APP/Contents/MacOS/$BIN_NAME" --make-icon "$BUILD/icon-1024.png"
fi
for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  set -- $spec
  sips -z "$1" "$1" "$BUILD/icon-1024.png" \
    --out "$ICONSET/icon_$2.png" >/dev/null 2>&1
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET" "$BUILD/icon-1024.png"

echo "==> signing"
# Use a real identity when one exists, because macOS binds permission grants
# (TCC: microphone, speech, screen, accessibility…) to the code signature. An
# ad-hoc signature hashes the binary, so every rebuild produces a different
# cdhash, macOS sees a different app, and the user is asked again for every
# permission they already granted. A certificate-based signature is stable
# across rebuilds and the grants stick.
#
# Override with: CODESIGN_IDENTITY="..." ./mac/build.sh
IDENTITY="${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
  | awk -F'"' '/Apple Development|Developer ID Application/ {print $2; exit}')}"

if [[ -n "$IDENTITY" ]]; then
  echo "    identity: $IDENTITY"
  if ! codesign --force --deep --sign "$IDENTITY" "$APP" 2>/dev/null; then
    echo "    (that identity failed; falling back to ad-hoc)"
    codesign --force --deep --sign - "$APP" 2>/dev/null || true
  fi
else
  echo "    no signing identity found — ad-hoc (permissions will re-prompt on rebuild)"
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
fi

echo
echo "built: $APP"
echo "run:   open \"$APP\""
echo "log:   \"$APP/Contents/MacOS/$BIN_NAME\"   # foreground, shows stderr"
