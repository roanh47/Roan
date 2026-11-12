#!/usr/bin/env bash
# Assert that a GitHub release has exactly the four assets we expect, with
# exact names and nothing else.
#
# Usage: scripts/check-artifacts.sh <tag> [<owner/repo>]
#
# The asset names embed the app version, so the tag must be v<version>
# (e.g. v0.0.1) and the version is taken from the tag itself. The repo is
# auto-detected from the current checkout when not passed.
#
# Exit codes: 0 = exactly the four expected assets, 1 = mismatch or lookup
# failure. Never mutates anything; safe to run in CI after a release.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <tag> [<owner/repo>]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
[ -n "${1:-}" ] || usage

tag="$1"
repo="${2:-}"

# --- Resolve the repository -------------------------------------------------
if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
if [ -z "$repo" ]; then
  echo "error: cannot determine repository; pass it as the second argument" >&2
  exit 1
fi

# --- Derive the version from the tag ---------------------------------------
if [[ ! "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?)$ ]]; then
  echo "error: tag '$tag' is not of the form v<major>.<minor>.<patch>" >&2
  exit 1
fi
version="${BASH_REMATCH[1]}"

expected=(
  "Roan-${version}-x64.exe"
  "Roan-${version}-arm64.dmg"
  "Roan-${version}-x86_64.AppImage"
  "Roan-${version}.apk"
)

# --- Fetch the release assets ----------------------------------------------
errfile="$(mktemp "${TMPDIR:-/tmp}/check-artifacts.XXXXXX")"
trap 'rm -f "$errfile"' EXIT

if ! listing="$(gh release view "$tag" --repo "$repo" --json assets -q '.assets[].name' 2>"$errfile")"; then
  echo "error: no release found for tag '$tag' in $repo" >&2
  sed 's/^/  gh: /' "$errfile" >&2 || true
  exit 1
fi

# One name per line, blanks dropped, sorted for stable comparison.
actual=()
while IFS= read -r name; do
  [ -n "$name" ] && actual+=("$name")
done <<< "$listing"

# --- Compare ---------------------------------------------------------------
missing=()
extra=()
for name in "${expected[@]}"; do
  found=0
  for got in "${actual[@]}"; do
    if [ "$got" = "$name" ]; then found=1; break; fi
  done
  [ "$found" -eq 1 ] || missing+=("$name")
done
for got in "${actual[@]}"; do
  found=0
  for name in "${expected[@]}"; do
    if [ "$got" = "$name" ]; then found=1; break; fi
  done
  [ "$found" -eq 1 ] || extra+=("$got")
done

echo "release: $repo@$tag"
echo "assets on release (${#actual[@]}):"
for got in "${actual[@]}"; do echo "  $got"; done

status=0
if [ "${#actual[@]}" -ne 4 ]; then
  echo "error: expected exactly 4 assets, found ${#actual[@]}" >&2
  status=1
fi
if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: missing expected asset(s):" >&2
  for name in "${missing[@]}"; do echo "  - $name" >&2; done
  status=1
fi
if [ "${#extra[@]}" -gt 0 ]; then
  echo "error: unexpected asset(s) (names must match exactly):" >&2
  for name in "${extra[@]}"; do echo "  + $name" >&2; done
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "FAIL: release assets do not match the expected four files" >&2
  exit 1
fi

echo "OK: all four expected assets are present and nothing else"
exit 0
