#!/bin/bash
# Bouwt de dmg met een "RUN THIS FIRST" bestand erin.
#
# Tauri's eigen dmg-bundler zet alleen de app en een snelkoppeling naar
# Applications in het venster. Dat is precies waarom een ongetekende app op een
# verse Mac blijft hangen op "beschadigd". Deze dmg zet er een .command bij dat
# de app kopieert, de quarantine-vlag weghaalt en hem opent.
#
# Alleen op macOS te draaien, na `tauri build --bundles app`.
#
#   scripts/dmg/build-dmg.sh 0.0.2
set -euo pipefail

VERSION="${1:-$(node -p "require('./src-tauri/tauri.conf.json').version")}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Roan.app"
STAGE="$ROOT/.dmg-stage"
OUT="$ROOT/local/builds"
NAME="Roan-${VERSION}-arm64"

test -d "$APP" || { echo "geen app-bundel op $APP, bouw eerst --bundles app"; exit 1; }

rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT"

cp -R "$APP" "$STAGE/Roan.app"
cp "$ROOT/scripts/dmg/RUN THIS FIRST.command" "$STAGE/RUN THIS FIRST.command"
chmod +x "$STAGE/RUN THIS FIRST.command"
ln -s /Applications "$STAGE/Applications"

# De app moet na het kopiëren nog steeds een geldige handtekening hebben.
codesign --force --deep --sign - "$STAGE/Roan.app"

rm -f "$OUT/$NAME.dmg"
hdiutil create \
  -volname "Roan $VERSION" \
  -srcfolder "$STAGE" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$OUT/$NAME.dmg"

rm -rf "$STAGE"
echo "geschreven: $OUT/$NAME.dmg"
ls -lh "$OUT/$NAME.dmg"
