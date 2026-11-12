#!/usr/bin/env bash
# Build the daemon as one self-contained executable per target.
#
#   scripts/build-sidecar.sh                 # x86_64-unknown-linux-gnu, SEA
#   scripts/build-sidecar.sh --target aarch64-unknown-linux-gnu
#   scripts/build-sidecar.sh --bun           # force the bun compiler
#
# Why a sidecar at all: the app is a Tauri shell and the daemon is Node. The app
# must not depend on a Node install on the user's machine, so the daemon is
# compiled into a single file and shipped next to the app. Tauri's
# `bundle.externalBin` looks for `src-tauri/binaries/roan-daemon-<rust-triple>`
# (with `.exe` on Windows), which is why the name carries the triple.
#
# Two compilers, in this order:
#   1. esbuild -> one CommonJS file, then Node's SEA (single executable
#      application) to graft that file onto a copy of the Node binary.
#   2. bun --compile, which is a real compiler and also cross-compiles. Used when
#      Node SEA is unavailable (no `postject`, or a target that is not the host's)
#      and whenever `--bun` is passed.
#
# SEA can only produce a binary for the platform whose Node you are running, so a
# `--target` that differs from `rustc -vV`'s host goes through bun. If neither can
# do it, the script fails instead of leaving a stale file behind.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT/src/daemon/main.ts"
STAGE="$ROOT/build/sidecar"
OUT_DIR="$ROOT/src-tauri/binaries"
NAME="roan-daemon"

FORCE_BUN=0
TARGET="${TARGET:-}"

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "build-sidecar: --target needs a triple" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --target=*)
      TARGET="${1#--target=}"
      shift
      ;;
    --bun)
      FORCE_BUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "build-sidecar: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

log() { printf 'build-sidecar: %s\n' "$*" >&2; }
die() { printf 'build-sidecar: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is not on PATH"

# The triple the app will look for. Ask rustc first; fall back to a guess so the
# script still works on a machine without a Rust toolchain (bun-only hosts).
host_triple() {
  if command -v rustc >/dev/null 2>&1; then
    rustc -vV | sed -n 's/^host: //p'
    return
  fi
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "x86_64-unknown-linux-gnu" ;;
    Linux-aarch64|Linux-arm64) echo "aarch64-unknown-linux-gnu" ;;
    Darwin-x86_64) echo "x86_64-apple-darwin" ;;
    Darwin-arm64) echo "aarch64-apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "x86_64-pc-windows-msvc" ;;
    *) die "cannot guess a rust target triple; pass --target" ;;
  esac
}

HOST="$(host_triple)"
TARGET="${TARGET:-$HOST}"

case "$TARGET" in
  *windows*) EXE=".exe" ;;
  *) EXE="" ;;
esac

OUT="$OUT_DIR/$NAME-$TARGET$EXE"

mkdir -p "$STAGE" "$OUT_DIR"

# esbuild from the repo's own node_modules; npx only as a last resort so a build
# does not silently pick up a different esbuild version.
esbuild_cmd() {
  if [[ -x "$ROOT/node_modules/.bin/esbuild" ]]; then
    printf '%s\n' "$ROOT/node_modules/.bin/esbuild"
  else
    printf 'npx --yes esbuild\n'
  fi
}

bundle_cjs() {
  local out="$1"
  local esbuild
  esbuild="$(esbuild_cmd)"
  # `ws` optionally requires two native add-ons inside try/catch; they are not
  # needed (ws falls back to its JS implementation) but esbuild resolves static
  # requires, so they are declared external.
  #
  # `import.meta.url` does not exist in CommonJS output. Nothing in the daemon's
  # reachable graph uses it today, but `src/chain/schema.ts` does, so it is
  # defined to a stable placeholder: a future import then reads its bundled
  # neighbours instead of crashing on an undefined URL.
  # shellcheck disable=SC2086
  $esbuild "$ENTRY" \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node22 \
    --log-level=warning \
    --define:import.meta.url='"file:///__roan_sidecar__/daemon.cjs"' \
    --external:bufferutil \
    --external:utf-8-validate \
    --outfile="$out"
}

try_bun() {
  command -v bun >/dev/null 2>&1 || return 1
  local bun_target
  case "$TARGET" in
    x86_64-unknown-linux-gnu) bun_target="bun-linux-x64" ;;
    x86_64-unknown-linux-musl) bun_target="bun-linux-x64-musl" ;;
    aarch64-unknown-linux-gnu) bun_target="bun-linux-arm64" ;;
    x86_64-apple-darwin) bun_target="bun-darwin-x64" ;;
    aarch64-apple-darwin) bun_target="bun-darwin-arm64" ;;
    x86_64-pc-windows-msvc) bun_target="bun-windows-x64" ;;
    *)
      log "no bun target for $TARGET"
      return 1
      ;;
  esac
  log "bun: compiling $ENTRY -> $OUT ($bun_target)"
  bun build "$ENTRY" --compile --minify --target="$bun_target" --outfile "$OUT" || return 1
  chmod +x "$OUT" 2>/dev/null || true
  [[ -s "$OUT" ]]
}

try_sea() {
  [[ "$TARGET" == "$HOST" ]] || { log "SEA cannot cross-compile to $TARGET; needs bun"; return 1; }

  local cjs="$STAGE/$NAME.cjs"
  local blob="$STAGE/$NAME.blob"
  local cfg="$STAGE/sea-config.json"

  log "esbuild: bundling $ENTRY"
  bundle_cjs "$cjs" || return 1

  cat > "$cfg" <<EOF
{
  "main": "$cjs",
  "output": "$blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": false
}
EOF

  log "node: preparing the SEA blob"
  node --experimental-sea-config "$cfg" || return 1

  # Copy the exact node that made the blob: the blob is only valid for the
  # matching V8/Node build.
  local node_bin="${NODE_BINARY:-$(command -v node)}"
  cp "$node_bin" "$OUT"
  chmod +x "$OUT"

  # macOS refuses to inject into a signed binary and needs its own segment name.
  if [[ "$TARGET" == *apple-darwin ]]; then
    command -v codesign >/dev/null 2>&1 && codesign --remove-signature "$OUT" 2>/dev/null || true
  fi

  local postject
  if [[ -x "$ROOT/node_modules/.bin/postject" ]]; then
    postject="$ROOT/node_modules/.bin/postject"
  else
    postject="npx --yes postject@1.0.0-alpha.6"
  fi

  log "postject: injecting the blob into $OUT"
  local args=(NODE_SEA_BLOB "$blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2)
  [[ "$TARGET" == *apple-darwin ]] && args+=(--macho-segment-name NODE_SEA)
  # postject prints one benign "Can't find string offset for section name '.note'"
  # warning per ELF note while it searches for the fuse; the real errors are the
  # ones left after filtering, and the exit code decides.
  local output status=0
  # shellcheck disable=SC2086
  output="$($postject "$OUT" "${args[@]}" 2>&1)" || status=$?
  printf '%s\n' "$output" | grep -v "Can't find string offset" >&2 || true
  [[ $status -eq 0 ]] || return 1

  if [[ "$TARGET" == *apple-darwin ]]; then
    command -v codesign >/dev/null 2>&1 && codesign --sign - "$OUT" 2>/dev/null || true
  fi

  [[ -s "$OUT" ]]
}

# A binary that starts and prints its banner is worth more than an exit code:
# bundling can succeed while the result cannot load a module at runtime. When a
# node with the repo's `ws` is available the check goes further and asks the
# daemon to create a chain, which is what actually opens SQLite.
probe_chain() {
  local port="$1"
  [[ -d "$ROOT/node_modules/ws" ]] || return 2
  command -v node >/dev/null 2>&1 || return 2
  ROAN_PROBE_PORT="$port" ROAN_PROBE_WS="$ROOT/node_modules/ws" node -e '
    const WebSocket = require(process.env.ROAN_PROBE_WS);
    const ws = new WebSocket("ws://127.0.0.1:" + process.env.ROAN_PROBE_PORT);
    const done = (code, text) => { console.log(text); process.exit(code); };
    const timer = setTimeout(() => done(1, "no answer from the daemon"), 5000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "create_chain" })));
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.t === "chain") { clearTimeout(timer); done(0, "chain " + frame.chain); }
      if (frame.t === "control_error") { clearTimeout(timer); done(1, frame.message); }
    });
    ws.on("error", (err) => { clearTimeout(timer); done(1, err.message); });
  ' >/dev/null 2>&1
}

verify() {
  [[ "$TARGET" == "$HOST" ]] || { log "skipping runtime check for a cross-built binary"; return 0; }
  local home log_file port
  home="$(mktemp -d)"
  log_file="$(mktemp)"
  port=$(( 20000 + RANDOM % 20000 ))
  ROAN_HOME="$home" ROAN_CONTROL_PORT="$port" ROAN_PEER_PORT="$((port + 1))" \
    "$OUT" >"$log_file" 2>&1 &
  local pid=$!
  local ok=1
  for _ in $(seq 1 40); do
    if grep -q "roan daemon:" "$log_file" 2>/dev/null; then ok=0; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  local probe=0
  if [[ $ok -eq 0 ]]; then
    probe=0
    probe_chain "$port" || probe=$?
  fi
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [[ $ok -ne 0 ]]; then
    log "the built binary did not start:"
    sed 's/^/  /' "$log_file" >&2 || true
    rm -rf "$home" "$log_file"
    return 1
  fi
  log "runtime check: $(grep -m1 'roan daemon:' "$log_file")"
  case "$probe" in
    0) log "channel check: created a chain over the control socket" ;;
    2) log "channel check: skipped (no node + ws to drive the socket)" ;;
    *)
      log "channel check: the daemon could not create a chain:"
      sed 's/^/  /' "$log_file" >&2 || true
      rm -rf "$home" "$log_file"
      return 1
      ;;
  esac
  rm -rf "$home" "$log_file"
}

rm -f "$OUT"

built=0
if [[ $FORCE_BUN -eq 1 ]]; then
  try_bun && built=1
else
  if try_sea; then
    built=1
  else
    log "Node SEA did not produce a binary; trying bun"
    rm -f "$OUT"
    try_bun && built=1
  fi
fi

if [[ $built -ne 1 || ! -s "$OUT" ]]; then
  rm -f "$OUT"
  die "no working binary for $TARGET (need node+postject for the host, or bun)"
fi

verify || { rm -f "$OUT"; die "the binary for $TARGET does not run"; }
chmod +x "$OUT"

size="$(du -h "$OUT" | cut -f1)"
log "built $OUT ($size)"
printf '%s\n' "$OUT"
