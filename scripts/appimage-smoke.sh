#!/usr/bin/env bash
# Prove a built AppImage actually launches: start it on a headless X display,
# wait for the Roan window and for the daemon sidecar, print what was observed,
# then shut both down.
#
#   scripts/appimage-smoke.sh                      # newest bundle/AppImage
#   scripts/appimage-smoke.sh path/to/Roan.AppImage --timeout 45
#
# Why the environment overrides: on a machine with no usable GPU (or with
# /dev/dri present but not readable by the user) WebKitGTK stalls in EGL init
# before the window is mapped. Software GL plus the dmabuf/compositing
# fallbacks make the webview come up; `GTK_USE_PORTAL=0` stops GTK waiting on a
# desktop portal a headless session does not have.
#
# Exits 0 only when the window (1180x780, title "Roan") and a `roan-daemon`
# process in the AppImage's process tree were both observed before the timeout.
set -uo pipefail

PROG="$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=""
TIMEOUT=60

usage() {
  cat <<'EOF'
Usage: appimage-smoke.sh [APPIMAGE] [--timeout SECONDS]

Start an AppImage on a headless Xvfb display and check that
  * a window titled "Roan" of 1180x780 is mapped, and
  * the roan-daemon sidecar runs inside that app's process tree.

Arguments:
  APPIMAGE            Default: newest *.AppImage under
                      src-tauri/target/release/bundle/appimage
  --timeout SECONDS   How long to wait for both. Default: 30
  -h, --help          This text.

Requires: Xvfb, xvfb-run, xwininfo (Debian: xvfb x11-utils).
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout)
      [ -n "${2:-}" ] || { echo "$PROG: --timeout needs a value" >&2; exit 2; }
      TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "$PROG: unknown argument $1 (try --help)" >&2; exit 2 ;;
    *) APP="$1"; shift ;;
  esac
done

if [ -z "$APP" ]; then
  APP="$(find "$ROOT/src-tauri/target/release/bundle/appimage" -maxdepth 1 -name '*.AppImage' 2>/dev/null | head -n 1)"
  [ -n "$APP" ] || { echo "$PROG: no AppImage found; build one with: npx tauri build --bundles appimage" >&2; exit 2; }
fi
[ -f "$APP" ] || { echo "$PROG: no such file: $APP" >&2; exit 2; }
APP="$(realpath -- "$APP")"

for tool in Xvfb xvfb-run xwininfo; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$PROG: $tool is required (Debian: apt install xvfb x11-utils)" >&2; exit 2; }
done

chmod +x "$APP" 2>/dev/null || true

WORK="$(mktemp -d "${TMPDIR:-/tmp}/roan-appimage-smoke.XXXXXX")"
cat > "$WORK/check.sh" <<'INNER'
set -uo pipefail
APP="$1"; TIMEOUT="$2"; WORK="$3"
export GDK_BACKEND=x11
export GTK_USE_PORTAL=0
export NO_AT_BRIDGE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1

# All descendants of $1, one pid per line (the AppImage runtime forks, so the
# daemon is a grandchild of the process we start).
descendants() {
  local pid="$1" child
  for child in $(ps -o pid= --ppid "$pid" 2>/dev/null); do
    echo "$child"
    descendants "$child"
  done
}

"$APP" > "$WORK/app.log" 2>&1 &
APP_PID=$!
cleanup() {
  local p
  for p in $(descendants "$APP_PID") "$APP_PID"; do kill "$p" 2>/dev/null; done
}
trap cleanup EXIT

window=""; daemon=""; i=0
while [ "$i" -lt "$TIMEOUT" ]; do
  sleep 1; i=$((i + 1))
  window="$(xwininfo -root -tree 2>/dev/null | grep -E '"Roan".*1180x780' | head -n 1)"
  for p in $(descendants "$APP_PID"); do
    if grep -q "roan-daemon" "/proc/$p/cmdline" 2>/dev/null; then
      daemon="$(tr '\0' ' ' < "/proc/$p/cmdline") (pid $p)"
      break
    fi
  done
  [ -n "$window" ] && [ -n "$daemon" ] && break
  kill -0 "$APP_PID" 2>/dev/null || break
done

echo "appimage:   $APP"
echo "app pid:    $APP_PID (alive: $(kill -0 "$APP_PID" 2>/dev/null && echo yes || echo no))"
echo "waited:     ${i}s"
echo "window:     ${window:-NOT FOUND}"
echo "daemon:     ${daemon:-NOT FOUND}"
echo "--- process tree ---"
ps -eo pid,ppid,stat,etime,cmd | awk -v p="$APP_PID" '$1==p || $2==p'
echo "--- window tree ---"
xwininfo -root -tree 2>/dev/null | sed -n '/children/,$p' | head -n 10
echo "--- app output (tail) ---"
tail -n 15 "$WORK/app.log" 2>/dev/null

[ -n "$window" ] && [ -n "$daemon" ] && exit 0
exit 1
INNER

xvfb-run -a --server-args="-screen 0 1280x800x24" bash "$WORK/check.sh" "$APP" "$TIMEOUT" "$WORK"
rc=$?
rm -rf "$WORK"
if [ "$rc" -eq 0 ]; then
  echo "RESULT: launched (window + daemon observed)"
else
  echo "RESULT: FAILED (window or daemon missing after ${TIMEOUT}s)"
fi
exit "$rc"
