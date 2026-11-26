#!/usr/bin/env bash
# Generate the release keystore for the Android APK and print the GitHub
# secret checklist. The keystore is key material: it is written outside the
# repository, with 0600 permissions, and this script never prints a password.
#
# Values come from the environment when set, otherwise from a silent prompt.
# Passwords are handed to keytool and gh through the environment and stdin, so
# they never appear in argv (`ps`) or in this script's output.
#
#   scripts/android-keystore.sh                 # prompt, write ~/.local/share/roan/keys
#   scripts/android-keystore.sh --upload        # also push secrets with gh
#   scripts/android-keystore.sh --help
#
# After the keystore exists, a release build must be signed with it; see
# docs/release.md ("Android keystore and secrets").
set -euo pipefail

PROG="$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/roan/keys"
DEFAULT_ALIAS="roan"

OUT=""
ALIAS="${ROAN_KEY_ALIAS:-$DEFAULT_ALIAS}"
UPLOAD=0
FORCE=0
DNAME="${ROAN_KEY_DNAME:-}"

usage() {
  cat <<'EOF'
Usage: android-keystore.sh [options]

Generate an Android release keystore (PKCS12, RSA 4096) outside the repo and
print the GitHub Actions secrets the release workflow needs.

Options:
  --out PATH      Where to write the keystore.
                  Default: $XDG_DATA_HOME/roan/keys/roan-release.p12
                  (~/.local/share/roan/keys/roan-release.p12)
                  Refused if PATH is inside this repository.
  --alias NAME    Key alias. Default: roan (or $ROAN_KEY_ALIAS).
  --dname NAME    X.500 distinguished name for the certificate.
                  Default: CN=Roan, O=Roan, C=NL (or $ROAN_KEY_DNAME).
  --upload        Also set the four repository secrets with an authenticated
                  `gh`. Never prints their values.
  --force         Overwrite an existing keystore at --out (refused otherwise).
  -h, --help      Show this help and exit 0.

Environment (optional; a TTY prompt is used when unset):
  ROAN_KEYSTORE_PASSWORD   store password (>= 6 characters)
  ROAN_KEY_PASSWORD        key password; defaults to the store password
  ROAN_KEY_ALIAS           key alias
  ROAN_KEY_DNAME           certificate distinguished name

Secrets produced (names only; this script does not print the values):
  ANDROID_KEYSTORE_BASE64      base64 of the keystore file
  ANDROID_KEYSTORE_PASSWORD    store password
  ANDROID_KEY_ALIAS            key alias
  ANDROID_KEY_PASSWORD         key password

The keystore is never committed. Back it up: losing it means every future
update must be published under a new application id.
EOF
}

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }

need_value() { # need_value FLAG VALUE
  [ -n "${2:-}" ] || die "$1 needs a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) need_value "$1" "${2:-}"; OUT="$2"; shift 2 ;;
    --alias) need_value "$1" "${2:-}"; ALIAS="$2"; shift 2 ;;
    --dname) need_value "$1" "${2:-}"; DNAME="$2"; shift 2 ;;
    --upload) UPLOAD=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

case "$ALIAS" in
  *[!A-Za-z0-9._-]*|"") die "alias must be non-empty and use only A-Z a-z 0-9 . _ -" ;;
esac

[ -n "$DNAME" ] || DNAME="CN=Roan, O=Roan, C=NL"

if [ -z "$OUT" ]; then
  OUT="$DEFAULT_DIR/roan-release.p12"
fi

# --- Refuse to write key material inside the repository ---------------------
# realpath -m resolves symlinks in the existing part of the path without
# requiring the file to exist yet, so ./keys/../scripts/../x is caught too.
OUT_ABS="$(realpath -m -- "$OUT")"
ROOT_ABS="$(realpath -m -- "$ROOT")"
case "$OUT_ABS" in
  "$ROOT_ABS"|"$ROOT_ABS"/*)
    die "refusing to write the keystore inside the repository ($ROOT_ABS); choose a path outside it, e.g. --out \"$DEFAULT_DIR/roan-release.p12\""
    ;;
esac
case "$OUT_ABS" in
  /proc/*|/sys/*|/dev/*) die "refusing to write to $OUT_ABS" ;;
esac
case "$OUT_ABS" in
  *.p12|*.pfx|*.jks|*.keystore) : ;;
  *) die "keystore path must end in .p12, .pfx, .jks or .keystore (got ${OUT_ABS##*/})" ;;
esac

command -v keytool >/dev/null 2>&1 || die "keytool not found; install a JDK (Debian: apt install default-jdk-headless)"

if [ -e "$OUT_ABS" ] && [ "$FORCE" -ne 1 ]; then
  die "$OUT_ABS already exists; pass --force to replace it (this invalidates signatures made with the old key)"
fi

# --- Passwords: env or silent prompt, never echoed --------------------------
read_secret() { # read_secret VARNAME PROMPT
  local __var="$1" __prompt="$2" __value=""
  if [ -t 0 ]; then
    printf '%s' "$__prompt" >&2
    IFS= read -rs __value
    printf '\n' >&2
  else
    die "$__var is not set and stdin is not a TTY; export it first"
  fi
  printf -v "$__var" '%s' "$__value"
}

STORE_PW="${ROAN_KEYSTORE_PASSWORD:-}"
KEY_PW="${ROAN_KEY_PASSWORD:-}"
[ -n "$STORE_PW" ] || read_secret STORE_PW "Keystore password (input hidden): "
[ "${#STORE_PW}" -ge 6 ] || die "keystore password must be at least 6 characters (Android/Java requirement)"
if [ -z "$KEY_PW" ]; then
  if [ -t 0 ]; then
    read_secret KEY_PW "Key password (input hidden, Enter reuses the store password): "
  fi
  [ -n "$KEY_PW" ] || KEY_PW="$STORE_PW"
fi
[ "${#KEY_PW}" -ge 6 ] || die "key password must be at least 6 characters"

# PKCS12 cannot hold a key password different from the store password.
STORE_TYPE="PKCS12"
EXTRA=()
if [ "$KEY_PW" != "$STORE_PW" ]; then
  STORE_TYPE="JKS"
  note "note: key password differs from store password, using JKS (PKCS12 stores a single password)"
fi

mkdir -p -- "$(dirname -- "$OUT_ABS")"
chmod 700 -- "$(dirname -- "$OUT_ABS")"

export ROAN_KS_STOREPASS="$STORE_PW"
export ROAN_KS_KEYPASS="$KEY_PW"

umask 077
note "Generating $STORE_TYPE keystore with RSA 4096 at $OUT_ABS (alias: $ALIAS)"
keytool -genkeypair \
  -keystore "$OUT_ABS" \
  -storetype "$STORE_TYPE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10000 \
  -dname "$DNAME" \
  -storepass:env ROAN_KS_STOREPASS \
  -keypass:env ROAN_KS_KEYPASS \
  2>&1 | sed 's/^/  /'

chmod 600 -- "$OUT_ABS"

# Prove the file is readable with the password we just set, without printing it.
if ! keytool -list -keystore "$OUT_ABS" -storepass:env ROAN_KS_STOREPASS >/dev/null 2>&1; then
  die "keystore was written but cannot be opened with the given password"
fi

B64="$(dirname -- "$OUT_ABS")/$(basename -- "${OUT_ABS%.*}").base64"
base64 -w0 -- "$OUT_ABS" > "$B64"
chmod 600 -- "$B64"

unset ROAN_KS_KEYPASS ROAN_KS_STOREPASS

# --- Output: names and commands, never values -------------------------------
cat <<EOF

Keystore:  $OUT_ABS  (600)
Base64:    $B64  (600)
Alias:     $ALIAS
Validity:  10000 days, RSA 4096
Passwords: not printed. They exist only in your shell env or your head.

GitHub repository secrets (Settings -> Secrets and variables -> Actions):
  ANDROID_KEYSTORE_BASE64      contents of $B64
  ANDROID_KEYSTORE_PASSWORD    the store password you entered
  ANDROID_KEY_ALIAS            $ALIAS
  ANDROID_KEY_PASSWORD         the key password you entered

Set them with gh (values travel on stdin, never in argv or output):
  gh secret set ANDROID_KEYSTORE_BASE64     < "$B64"
  printf '%s' "\$ROAN_KEYSTORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD
  gh secret set ANDROID_KEY_ALIAS -b "$ALIAS"
  printf '%s' "\$ROAN_KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD

Back up the keystore and its passwords somewhere off this machine. Losing them
means no further update can be signed for the installed app.
EOF

if [ "$UPLOAD" -eq 1 ]; then
  command -v gh >/dev/null 2>&1 || die "--upload needs the GitHub CLI (gh)"
  gh auth status >/dev/null 2>&1 || die "--upload needs an authenticated gh (run: gh auth login)"
  note "Setting repository secrets with gh..."
  gh secret set ANDROID_KEYSTORE_BASE64 < "$B64"
  if [ -n "${ROAN_KEYSTORE_PASSWORD:-}" ]; then
    printf '%s' "$ROAN_KEYSTORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD
  else
    note "  ANDROID_KEYSTORE_PASSWORD skipped: export ROAN_KEYSTORE_PASSWORD to upload it"
  fi
  gh secret set ANDROID_KEY_ALIAS -b "$ALIAS"
  if [ -n "${ROAN_KEY_PASSWORD:-}" ]; then
    printf '%s' "$ROAN_KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD
  else
    note "  ANDROID_KEY_PASSWORD skipped: export ROAN_KEY_PASSWORD to upload it"
  fi
  gh secret list
fi
