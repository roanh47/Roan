#!/bin/bash
# RUN THIS FIRST
#
# macOS weigert een app die van internet komt en niet door Apple is
# goedgekeurd. Zonder handtekening noemt hij hem zelfs "beschadigd" in plaats
# van "onbekende ontwikkelaar". Dit bestand zet de app in Applications, haalt
# dat oordeel weg en opent hem.
#
# Je hoeft niets in te typen. Dubbelklik dit bestand, klaar.

set -u

APP_NAME="Roan.app"
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="/Applications/$APP_NAME"

echo "Roan installeren..."
echo

if [ ! -d "$HERE/$APP_NAME" ]; then
  echo "Ik zie $APP_NAME niet naast dit bestand."
  echo "Open de dmg opnieuw en dubbelklik dit bestand vanuit het venster."
  echo
  read -r -p "Druk op enter om te sluiten."
  exit 1
fi

# Een oude versie eerst weg, anders blijft er een half overschreven bundel staan.
if [ -d "$TARGET" ]; then
  echo "Oude versie in Applications wordt vervangen."
  rm -rf "$TARGET" 2>/dev/null || {
    echo "Kon de oude versie niet weghalen. Sleep $APP_NAME zelf naar Applications en open hem daarna."
    read -r -p "Druk op enter om te sluiten."
    exit 1
  }
fi

if ! cp -R "$HERE/$APP_NAME" "$TARGET"; then
  echo
  echo "Kopiëren naar Applications lukte niet."
  echo "Sleep $APP_NAME zelf naar de map Applications en dubbelklik daarna dit bestand opnieuw."
  read -r -p "Druk op enter om te sluiten."
  exit 1
fi

# Dit is de regel die de "beschadigd" melding wegneemt.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
codesign --force --deep --sign - "$TARGET" 2>/dev/null

echo "Klaar. Roan staat in Applications en gaat nu open."
echo "De volgende keer open je hem gewoon met een dubbelklik."
echo
open "$TARGET"
