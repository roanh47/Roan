#!/usr/bin/env node
/**
 * Builds the daemon as a single executable, so the desktop app can carry it.
 *
 * Node ships the ability to glue a script onto its own binary (SEA). The daemon
 * uses `ws`, so it is bundled first — an SEA cannot resolve node_modules at
 * runtime. The result is written to src-tauri/binaries with the triple in the
 * name, which is the name Tauri looks for.
 *
 *   node scripts/build-sidecar.mjs x86_64-unknown-linux-gnu
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const triple = process.argv[2] ?? "x86_64-unknown-linux-gnu";
const outDir = join(root, "src-tauri", "binaries");
const work = join(root, ".sidecar");
const bundle = join(work, "daemon.cjs");
const blob = join(work, "daemon.blob");
// Tauri zoekt op Windows naar hetzelfde pad met .exe erachter.
const suffix = process.platform === "win32" ? ".exe" : "";
const target = join(outDir, `roan-daemon-${triple}${suffix}`);

mkdirSync(outDir, { recursive: true });
mkdirSync(work, { recursive: true });

/**
 * `npx` is een shell-script op Linux en macOS, maar `npx.cmd` op Windows; Node
 * kan dat pad niet raden. Daarom praten we esbuild via zijn API aan en starten
 * we postject als JS-bestand met node — op elk platform hetzelfde.
 */
const cli = (name) => join(root, "node_modules", name);

console.log(`bundling the daemon for ${triple}`);
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(root, "dist", "daemon", "main.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
  logLevel: "info",
});

const seaConfig = join(work, "sea-config.json");
writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }),
);
console.log("preparing the node blob");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { cwd: root, stdio: "inherit" });

console.log("copying the node binary");
copyFileSync(process.execPath, target);

if (process.platform === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", target], { stdio: "ignore" });
  } catch {
    // unsigned builds have nothing to strip
  }
}

console.log("injecting the blob");
execFileSync(
  process.execPath,
  [
    cli("postject/dist/cli.js"),
    target,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "--macho-segment-name",
    "NODE_SEA",
  ],
  { cwd: root, stdio: "inherit" },
);

if (process.platform !== "win32") execFileSync("chmod", ["+x", target]);

rmSync(work, { recursive: true, force: true });
if (!existsSync(target)) throw new Error("no sidecar was produced");
console.log(`wrote ${target}`);
