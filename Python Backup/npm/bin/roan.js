#!/usr/bin/env node
// Launcher voor Roan. De harness zelf is Python; dit pakket start hem alleen.
// npm is hier de naamhouder, niet de runtime.

const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);

// Volgorde: console script (roan/Roan), dan de module, dan Windows' py-launcher.
const attempts = [
  { cmd: "roan", args },
  { cmd: "Roan", args },
  { cmd: process.env.ROAN_PYTHON || "python3", args: ["-m", "roan", ...args] },
  { cmd: "py", args: ["-m", "roan", ...args] },
];

function notFound(err) {
  return err && (err.code === "ENOENT" || err.code === "EACCES");
}

let lastError = null;

for (const attempt of attempts) {
  const res = spawnSync(attempt.cmd, attempt.args, { stdio: "inherit" });
  if (res.error) {
    if (notFound(res.error)) {
      lastError = res.error;
      continue; // deze bestaat niet, volgende proberen
    }
    console.error(`roan: kon ${attempt.cmd} niet starten — ${res.error.message}`);
    process.exit(1);
  }
  if (typeof res.status === "number") process.exit(res.status);
  process.exit(0);
}

console.error(
  [
    "",
    "Roan is nog niet geïnstalleerd. De harness is Python, dit npm-pakket start hem alleen.",
    "",
    "Installeer hem eenmalig met een van deze:",
    "",
    "  git clone https://github.com/roanh47/Roan.git && cd Roan",
    "  git checkout pre-release          # of: main, voor de stabiele tak",
    "  pip install -e .",
    "",
    "Daarna werkt `roan` in elke map, en dus ook via npx.",
    lastError ? `\n(python3/roan niet gevonden: ${lastError.code})` : "",
  ].join("\n"),
);
process.exit(127);
