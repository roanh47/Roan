// Bundles the daemon into one CommonJS file that a bare Node runtime can run.
//
// The desktop sidecar has the same first step (scripts/build-sidecar.mjs) and
// then wraps it in a Node single executable. Android cannot start an executable
// that is not in the apk, so there the bundle is copied into assets and handed
// to libnode as a script path.
import { build } from "esbuild";

const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: node scripts/bundle-daemon.mjs <outfile>\n");
  process.exit(2);
}

await build({
  entryPoints: ["dist/daemon/main.js"],
  outfile: target,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  logLevel: "info",
});
