#!/usr/bin/env bash
# Gives the Android app a Node runtime and the daemon to run on it.
#
# Android will not exec a binary that is not in the apk, and Tauri has no
# externalBin on Android, so the daemon cannot be a sidecar there. Instead the
# Node runtime is linked in as a library (libnode.so, from the nodejs-mobile
# recipe) and started from Kotlin; the daemon itself ships as one bundled .js in
# assets. That is what makes the phone a node with its own chain instead of a
# window onto another machine.
#
# Idempotent: run it after every `tauri android init`, before the gradle build.
#   scripts/android-daemon.sh [abi ...]        (default: arm64-v8a)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/src-tauri/gen/android/app"
SRC="$ROOT/src-tauri/android"
VER="${ROAN_LIBNODE_VERSION:-24.20.0}"
CACHE="${ROAN_LIBNODE_CACHE:-$HOME/.cache/roan/libnode}"
ABIS=("${@:-arm64-v8a}")

if [ ! -d "$APP" ]; then
  echo "no Android project at $APP — run: npx tauri android init" >&2
  exit 1
fi

# abi -> the architecture name in the libnode release
arch_for() {
  case "$1" in
    arm64-v8a) echo arm64 ;;
    armeabi-v7a) echo arm ;;
    x86_64) echo x64 ;;
    x86) echo "" ;;
    *) echo "" ;;
  esac
}

mkdir -p "$CACHE" "$APP/src/main/jniLibs" "$APP/src/main/cpp/libnode/include" \
  "$APP/src/main/assets" "$APP/src/main/res/xml"

# Old build output carries the other ABIs, and gradle takes the ABI list from
# jniLibs when it is not told otherwise — which drags the whole four-ABI rust
# build back in. Prune to what is asked for, so the apk really is one ABI.
for dir in "$APP/src/main/jniLibs"/*; do
  [ -d "$dir" ] || continue
  keep=0
  for abi in "${ABIS[@]}"; do [ "$(basename "$dir")" = "$abi" ] && keep=1; done
  [ "$keep" = 1 ] || rm -rf "$dir"
done

for abi in "${ABIS[@]}"; do
  arch="$(arch_for "$abi")"
  if [ -z "$arch" ]; then
    echo "no libnode build for ABI $abi" >&2
    exit 1
  fi
  tarball="$CACHE/libnode_android_$arch-$VER.tar.gz"
  dir="$CACHE/libnode_android_$arch-$VER"
  if [ ! -f "$dir/lib/libnode.so" ]; then
    if [ ! -f "$tarball" ]; then
      echo "== fetching libnode $VER for $arch"
      curl -fsSL -o "$tarball" \
        "https://github.com/lakutata/libnode/releases/download/v$VER/libnode_android_$arch.tar.gz"
    fi
    mkdir -p "$dir"
    tar xzf "$tarball" -C "$dir" --strip-components=1
  fi
  mkdir -p "$APP/src/main/jniLibs/$abi"
  cp "$dir/lib/libnode.so" "$APP/src/main/jniLibs/$abi/libnode.so"
  echo "== libnode ($abi) -> jniLibs/$abi/libnode.so"
done

# Headers come from any slice: they are the same api for every ABI.
first_arch="$(arch_for "${ABIS[0]}")"
if [ -d "$CACHE/libnode_android_$first_arch-$VER/include/node" ]; then
  rm -rf "$APP/src/main/cpp/libnode/include/node"
  cp -a "$CACHE/libnode_android_$first_arch-$VER/include/node" \
    "$APP/src/main/cpp/libnode/include/node"
elif [ ! -d "$APP/src/main/cpp/libnode/include/node" ]; then
  echo "libnode headers missing — check the release archive" >&2
  exit 1
fi

cp "$SRC/start-node.cpp" "$SRC/CMakeLists.txt" "$APP/src/main/cpp/"
cp "$SRC/RoanNode.kt" "$APP/src/main/java/dev/roan/RoanNode.kt"

# The launcher icon is the app's own icon, used as it is. `tauri icon` writes
# into the generated res and also emits an adaptive icon, whose foreground the
# launcher scales up and crops — that is what made the photo look zoomed in. The
# plain mipmap PNGs are the photo itself, so the adaptive variant goes.
RES="$APP/src/main/res"
if [ -f "$ROOT/src-tauri/icons/icon-square.png" ]; then
  (cd "$ROOT" && npx tauri icon src-tauri/icons/icon-square.png >/dev/null 2>&1) || true
fi
rm -rf "$RES/mipmap-anydpi-v26" "$RES"/mipmap-anydpi
find "$RES" -name 'ic_launcher_foreground.png' -delete
echo "== launcher icons -> res ($(ls -d "$RES"/mipmap-* 2>/dev/null | wc -l) buckets, adaptive removed)"

if [ ! -f "$ROOT/dist/daemon/main.js" ]; then
  echo "dist/ is missing — run: npm run build" >&2
  exit 1
fi
node "$ROOT/scripts/bundle-daemon.mjs" "$APP/src/main/assets/roan-daemon.js"
echo "== daemon bundle -> assets/roan-daemon.js ($(du -h "$APP/src/main/assets/roan-daemon.js" | cut -f1))"

cat > "$APP/src/main/res/xml/network_security_config.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- The daemon on this device is reached over loopback, so plain ws:// must be
     allowed there and nowhere else. The shell's own origin is tauri.localhost. -->
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">tauri.localhost</domain>
    <domain includeSubdomains="false">::1</domain>
  </domain-config>
</network-security-config>
XML

python3 - "$APP" "${ABIS[@]}" <<'PY'
import pathlib
import re
import sys

app = pathlib.Path(sys.argv[1])
abis = sys.argv[2:]
marker = "// roan: libnode"

# --- gradle: package libnode, build the JNI bridge, keep the apk to one ABI ---
gradle = app / "build.gradle.kts"
text = gradle.read_text()
if marker not in text:
    if re.search(r"^\s*ndk\s*\{", text, re.M):
        text = re.sub(r"^\s*ndk\s*\{[^}]*\}", "", text, flags=re.M)
    abi_list = ", ".join(f'"{abi}"' for abi in abis)
    block = f"""
    {marker}: the daemon runs in-app on libnode (no externalBin exists on Android)
    ndk {{
        abiFilters += listOf({abi_list})
    }}
    externalNativeBuild {{
        cmake {{
            arguments += listOf("-DANDROID_STL=c++_shared")
        }}
    }}
"""
    # inside defaultConfig { ... }
    start = text.index("defaultConfig {")
    close = text.index("    }", start)
    text = text[:close] + block + text[close:]
    # top-level android { } gains the cmake path
    android_start = text.index("android {")
    text = (
        text[: android_start + len("android {")]
        + '\n    externalNativeBuild {\n        cmake {\n            path = file("src/main/cpp/CMakeLists.txt")\n        }\n    }\n'
        + text[android_start + len("android {"):]
    )
    gradle.write_text(text)

# Unsstripped debug symbols are most of the apk: 160 MB per ABI of the Rust
# shell. Let gradle strip them.
gradle_write = gradle.read_text()
stripped = re.sub(r"^[ \t]*jniLibs\.keepDebugSymbols\.add\([^\n]*\n", "", gradle_write, flags=re.M)
if stripped != gradle_write:
    gradle.write_text(stripped)

# tauri's generated Rust plugin takes its ABI list from gradle properties, and
# its "universal" flavour defaults to all four. Without this the apk carries a
# rust shell for ABIs that have no libnode and no reason to be shipped.
ARCH = {
    "arm64-v8a": ("arm64", "aarch64"),
    "armeabi-v7a": ("arm", "armv7"),
    "x86": ("x86", "i686"),
    "x86_64": ("x86_64", "x86_64"),
}
props = app.parent / "gradle.properties"
text = props.read_text() if props.exists() else ""
for key in ("abiList", "archList", "targetList"):
    text = re.sub(rf"^{key}=.*$", "", text, flags=re.M)
archs = [ARCH[abi][0] for abi in abis if abi in ARCH]
targets = [ARCH[abi][1] for abi in abis if abi in ARCH]
text = text.rstrip() + "\n" + "\n".join(
    [
        "# roan: one ABI, one rust target, one libnode",
        f"abiList={','.join(abis)}",
        f"archList={','.join(archs)}",
        f"targetList={','.join(targets)}",
        "",
    ]
)
props.write_text(text)

# --- version: an install must be able to replace the previous one ---
conf = pathlib.Path(sys.argv[1]).parent.parent.parent / "tauri.conf.json"
props_file = app / "tauri.properties"
if conf.exists() and props_file.exists():
    version = re.search(r'"version"\s*:\s*"([^"]+)"', conf.read_text())
    if version is not None:
        parts = (version.group(1).split(".") + ["0", "0", "0"])[:3]
        code = int(parts[0]) * 10_000 + int(parts[1]) * 100 + int(parts[2])
        text = re.sub(r"^tauri\.android\.versionName=.*$", f"tauri.android.versionName={version.group(1)}",
                      props_file.read_text(), flags=re.M)
        text = re.sub(r"^tauri\.android\.versionCode=.*$", f"tauri.android.versionCode={code}", text, flags=re.M)
        props_file.write_text(text)

# --- manifest: allow the loopback daemon over plain ws ---
manifest = app / "src/main/AndroidManifest.xml"
text = manifest.read_text()
if "networkSecurityConfig" not in text:
    text = text.replace(
        'android:usesCleartextTraffic="${usesCleartextTraffic}"',
        'android:usesCleartextTraffic="${usesCleartextTraffic}"\n        android:networkSecurityConfig="@xml/network_security_config"',
    )
    manifest.write_text(text)

# --- activity: start the daemon before the webview asks for it ---
activity = app / "src/main/java/dev/roan/MainActivity.kt"
text = activity.read_text()
if "RoanNode.ensureStarted" not in text:
    text = text.replace(
        "    enableEdgeToEdge()",
        "    // Every device is a node: the daemon starts with the app.\n    RoanNode.ensureStarted(applicationContext)\n    enableEdgeToEdge()",
    )
    activity.write_text(text)
PY

echo "== Android project wired: $(ls "$APP/src/main/jniLibs")"
