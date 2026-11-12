#!/usr/bin/env bash
# Build the daemon, run it against a throwaway ROAN_HOME, print the control
# port it actually bound, and follow its log until ctrl-c stops it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build

ROAN_HOME="$(mktemp -d "${TMPDIR:-/tmp}/roan-dev.XXXXXX")"
LOG="$ROAN_HOME/daemon.log"
export ROAN_HOME
# 0 asks the kernel for a free port, so a daemon already on 7411 is not in the way.
export ROAN_CONTROL_PORT="${ROAN_CONTROL_PORT:-0}"

node dist/daemon/main.js >"$LOG" 2>&1 &
PID=$!
TAIL_PID=""

cleanup() {
  if [ -n "$TAIL_PID" ]; then
    kill "$TAIL_PID" 2>/dev/null || true
    wait "$TAIL_PID" 2>/dev/null || true
  fi
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$ROAN_HOME"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The daemon prints "control port N" on stderr once it is listening.
port=""
for _ in $(seq 1 100); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "dev.sh: daemon exited during startup" >&2
    cat "$LOG" >&2
    exit 1
  fi
  port="$(grep -oE 'control port [0-9]+' "$LOG" 2>/dev/null | head -n 1 | grep -oE '[0-9]+' || true)"
  [ -n "$port" ] && break
  sleep 0.1
done
if [ -z "$port" ]; then
  echo "dev.sh: daemon did not report a control port within 10s" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "roan dev: ROAN_HOME=$ROAN_HOME"
echo "roan dev: control port $port  (ws://127.0.0.1:$port/ws)"
echo "roan dev: following $LOG — ctrl-c stops the daemon"
echo

# --pid makes tail exit when the daemon does, instead of hanging forever.
# Tail runs in the background so the shell is not blocked in a foreground
# command: bash only runs a signal trap once the foreground job returns, and
# `tail -f` never does. `wait` is interrupted by a signal, so ctrl-c reaches
# the trap immediately and cleanup stops both the tail and the daemon.
tail -n +1 -f --pid="$PID" "$LOG" &
TAIL_PID=$!
wait "$TAIL_PID" || true
if ! kill -0 "$PID" 2>/dev/null; then
  code=0
  wait "$PID" 2>/dev/null || code=$?
  echo "roan dev: daemon exited (status $code)" >&2
fi
