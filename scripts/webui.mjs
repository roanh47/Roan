#!/usr/bin/env node
/**
 * Compatibility shim. The daemon serves the web UI itself now — static files,
 * the control socket on `/ws` and peers on `/peer`, all on one port — so there
 * is nothing left to proxy and no second process to run.
 *
 * Anyone with an old unit file that starts this script keeps working: it waits
 * for the daemon's port, prints the URL and stays alive (a unit that exits gets
 * restarted in a loop). Nothing depends on it.
 *
 *   node scripts/webui.mjs
 *   ROAN_PORT=7626 node scripts/webui.mjs     # ROAN_CONTROL_PORT still works
 */
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env["ROAN_PORT"] ?? process.env["ROAN_CONTROL_PORT"] ?? 6769);
const HOST = process.env["ROAN_WEB_HOST"] ?? "127.0.0.1";
const BASE = `http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${String(PORT)}`;

async function probe() {
  try {
    const response = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1_500) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

let health = await probe();
for (let attempt = 0; health === null && attempt < 20; attempt += 1) {
  await sleep(250);
  health = await probe();
}

if (health === null) {
  console.error(`roan webui: nothing answers on ${BASE} — start the daemon (roan daemon / dist/daemon/main.js) first`);
  process.exit(1);
}

console.log(`roan webui: the daemon serves the UI itself — open ${BASE}/`);
if (health.ui === false) {
  console.log("roan webui: web/dist is not built yet; run `npm run build` in web/ to get the page");
}
// Stay up so a service manager does not treat this as a crash loop, and so the
// shim can be stopped like the old process. Nothing is listening here.
setInterval(() => undefined, 60_000);
