#!/bin/bash
# Bouwt Roan lokaal op de server: eerst de Linux-AppImage, dan de apk.
#
# Bedoeld voor een versie die nog niet naar GitHub mag. De bestanden komen in
# local/builds en worden via Filebrowser geserveerd.
#
#   scripts/build-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
OUT="$ROOT/local/builds"
mkdir -p "$OUT"

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/roan.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$HOME/.tauri/roan-pass.txt")"

echo "== web bouwen"
npm --prefix web ci --no-audit --no-fund >/dev/null
npm --prefix web run build

echo "== agent bouwen"
npm ci --no-audit --no-fund >/dev/null
npm run build | tail -2
node scripts/build-sidecar.mjs x86_64-unknown-linux-gnu

echo "== AppImage"
npx tauri build --config src-tauri/tauri.desktop.conf.json --bundles appimage 2>&1 | tail -20
APPIMG="$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' | head -n 1)"
cp "$APPIMG" "$OUT/Roan-${VERSION}-x86_64.AppImage"
chmod +x "$OUT/Roan-${VERSION}-x86_64.AppImage"
[ -f "$APPIMG.sig" ] && cp "$APPIMG.sig" "$OUT/Roan-${VERSION}-x86_64.AppImage.sig"

echo "== apk"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -n 1)"
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
if [ ! -d src-tauri/gen/android ]; then
  npx tauri android init --ci
fi
npx tauri android build --apk --debug --ci 2>&1 | tail -20
APK="$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' | head -n 1)"
cp "$APK" "$OUT/Roan-${VERSION}.apk"
[ -f "$APK.sig" ] && cp "$APK.sig" "$OUT/Roan-${VERSION}.apk.sig"

echo
echo "== klaar"
ls -lh "$OUT"
