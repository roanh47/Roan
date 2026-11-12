#!/usr/bin/env node
/**
 * Serves the Roan web UI and gives the browser a way to reach the daemon.
 *
 * The daemon's socket is loopback-only and speaks one protocol. A browser that
 * loads the page from another machine cannot open it, so this server serves the
 * bundle and proxies `/ws` to the daemon on this host. Same origin, one port,
 * nothing else to configure.
 *
 *   node scripts/webui.mjs            # http://0.0.0.0:8440
 *   ROAN_WEB_PORT=9000 ROAN_CONTROL_PORT=7411 node scripts/webui.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "web", "dist");
const PORT = Number(process.env["ROAN_WEB_PORT"] ?? 8440);
const HOST = process.env["ROAN_WEB_HOST"] ?? "0.0.0.0";
const DAEMON = process.env["ROAN_CONTROL_URL"] ?? `ws://127.0.0.1:${process.env["ROAN_CONTROL_PORT"] ?? 7411}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function send(res, file) {
  const body = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, daemon: DAEMON }));
    return;
  }
  // Everything that is not a file is the app: the UI routes client-side.
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (path === "" || path.endsWith("/")) path = "index.html";
  try {
    await send(res, join(DIST, path));
  } catch {
    try {
      await send(res, join(DIST, "index.html"));
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("web/dist is missing: run npm run build in web/ first");
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(DAEMON + "/ws");
    const queue = [];
    let open = false;

    // The browser speaks first (state/hello); hold its frames until the daemon
    // link is up instead of dropping them, or the first screen stays empty.
    client.on("message", (data, isBinary) => {
      const payload = isBinary ? data : data.toString();
      if (open && upstream.readyState === WebSocket.OPEN) upstream.send(payload);
      else queue.push(payload);
    });

    upstream.on("open", () => {
      open = true;
      for (const payload of queue.splice(0)) upstream.send(payload);
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(isBinary ? data : data.toString());
    });

    const closeBoth = () => {
      if (client.readyState === WebSocket.OPEN) client.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    upstream.on("close", closeBoth);
    upstream.on("error", (err) => {
      console.error("daemon link failed:", err.message);
      closeBoth();
    });
    client.on("close", closeBoth);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`roan webui on http://${HOST}:${PORT} -> daemon ${DAEMON}`);
});
