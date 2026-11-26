/**
 * The HTTP side of the control port: the built web UI, the log tail, and a
 * health line — served from the same `http.createServer` that upgrades `/ws`.
 *
 * One port, one origin. The browser loads the page and opens the socket at
 * `/ws` on the same host it fetched the page from, so there is nothing to proxy
 * and no second process to keep alive.
 *
 * Everything here is about reading files that were built earlier: the server
 * never writes, never lists a directory, and never resolves a path outside the
 * dist root. A request for something that is not there answers honestly instead
 * of handing back index.html, so a missing asset shows up as a 404 in the
 * console rather than as a JavaScript parse error in the page.
 */

import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * `web/dist` next to the package root. `src/daemon/control-http.ts` and
 * `dist/daemon/control-http.js` are both two levels below it, so the same
 * relative walk works in dev (`tsx`) and in the build.
 */
/** Where `web/dist` sits relative to the running file; never throws. */
export function webDistFrom(base: string | URL): string {
  try {
    return fileURLToPath(new URL("../../web/dist", base));
  } catch {
    return resolve(process.cwd(), "web/dist");
  }
}

export function defaultWebDist(): string {
  // The Android build runs this file as one bundled asset, where `import.meta.url`
  // is not a file URL at all. Resolving it there threw "Invalid URL" and killed the
  // daemon before it listened, so the phone showed "waiting for the daemon".
  // A missing dist is not fatal: the server answers an honest page instead.
  return webDistFrom(import.meta.url);
}

/**
 * Whether an upgrade came from this machine. `::ffff:127.0.0.1` is what a
 * dual-stack socket reports for an IPv4 loopback caller, and the whole
 * `127.0.0.0/8` block counts: every address in it is this host.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined || address.length === 0) return false;
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const v4 = mapped?.[1] ?? address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

export interface WebHandlerOptions {
  /** Directory the built UI was written to. Missing is not an error. */
  readonly dist: string;
  /** The tail of the daemon's own output, served as text/plain at `/log`. */
  readonly log?: () => string;
}

/** What a request resolved to, before anything touches the disk. */
type Resolution =
  | { readonly kind: "file"; readonly path: string; readonly rel: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "missing" };

const NOT_BUILT = [
  "The Roan web UI has not been built on this machine.",
  "",
  "This daemon serves the UI itself, from web/dist, and that folder is missing",
  "(or holds no index.html yet). Build it once:",
  "",
  "    cd web && npm install && npm run build",
  "",
  "Then reload this page. The control WebSocket is live on this port already,",
  "at /ws, so the desktop and mobile apps work without the page.",
  "",
].join("\n");

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Splits the raw request target into decoded segments, or refuses it.
 *
 * The raw target is used on purpose: `new URL()` silently resolves `..` and
 * `%2e%2e` before anyone can look at it, so a traversal attempt would arrive
 * as a harmless-looking path. Here every segment is decoded and checked, and a
 * segment that turns into `/`, `\`, a dot name or a dotfile stops the request.
 */
function splitTarget(raw: string | undefined): { segments: string[]; trailingSlash: boolean } | "bad" | "refused" {
  const target = raw ?? "/";
  if (!target.startsWith("/")) return "bad";
  const cut = target.indexOf("?");
  const pathname = cut === -1 ? target : target.slice(0, cut);
  const segments: string[] = [];
  for (const rawSegment of pathname.split("/")) {
    if (rawSegment.length === 0) continue;
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return "bad";
    }
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return "refused";
    if (segment === "." || segment === "..") return "refused";
    if (segment.startsWith(".")) return "refused";
    segments.push(segment);
  }
  return { segments, trailingSlash: pathname.endsWith("/") };
}

/**
 * Maps decoded segments onto a file under `root`, or refuses it.
 *
 * `splitTarget` already refused dotted and traversal segments; the resolved
 * path is checked again so a bug there cannot escape the root.
 */
function resolveRequest(
  root: string,
  segments: readonly string[],
  trailingSlash: boolean,
  allowMissing: boolean,
): Resolution {
  const rel = segments.length === 0 || trailingSlash ? join(...segments, "index.html") : join(...segments);
  const absolute = resolve(root, rel);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return { kind: "refused", reason: "refused: illegal path" };
  }
  if (isFile(absolute)) return { kind: "file", path: absolute, rel };
  // A directory with a trailing slash has already been turned into index.html;
  // a directory without one falls through to the app shell like any other
  // client-side route.
  if (allowMissing && extname(rel) === "") {
    const index = join(root, "index.html");
    if (isFile(index)) return { kind: "file", path: index, rel: "index.html" };
  }
  return { kind: "missing" };
}

function streamFile(req: IncomingMessage, res: ServerResponse, path: string, rel: string): void {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    sendText(res, 404, "not found\n");
    return;
  }
  const hashed = rel.startsWith("assets/");
  res.writeHead(200, {
    "content-type": contentTypeFor(path),
    "content-length": size,
    // Vite writes content-hashed names into assets/: those may be cached for
    // ever. index.html must not be, or a rebuild never reaches the browser.
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.on("error", () => {
    if (!res.headersSent) sendText(res, 500, "could not read that file\n");
    else res.destroy();
  });
  stream.pipe(res);
}

/**
 * The request listener for the control port. Returned rather than registered so
 * `control.ts` owns the server, the upgrade handler and the lifetime.
 */
export function createWebHandler(options: WebHandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const root = resolve(options.dist);
  const indexExists = (): boolean => isFile(join(root, "index.html"));

  return (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("allow", "GET, HEAD");
        sendText(res, 405, "only GET and HEAD are served here\n");
        return;
      }

      const parsed = splitTarget(req.url);
      if (parsed === "bad") {
        sendText(res, 400, "bad request\n");
        return;
      }
      if (parsed === "refused") {
        sendText(res, 403, "refused: illegal path\n");
        return;
      }
      const { segments, trailingSlash } = parsed;
      const only = segments.length === 1 ? segments[0] : undefined;

      if (only === "healthz") {
        sendText(res, 200, JSON.stringify({ ok: true, ui: indexExists(), dist: root }) + "\n", "application/json; charset=utf-8");
        return;
      }

      // The log used to be its own port (7413) and its own fetch. Same socket
      // now: one origin, one thing running.
      if (only === "log") {
        const text = options.log?.() ?? "";
        sendText(res, 200, text.trim().length === 0 ? "the daemon wrote nothing yet\n" : text);
        return;
      }

      if (!indexExists()) {
        sendText(res, 503, NOT_BUILT);
        return;
      }

      const resolution = resolveRequest(root, segments, trailingSlash, true);
      if (resolution.kind === "refused") {
        sendText(res, 403, resolution.reason + "\n");
        return;
      }
      if (resolution.kind === "missing") {
        // An asset that is not there is a broken build, not a route: say so.
        sendText(res, 404, "not found\n");
        return;
      }
      streamFile(req, res, resolution.path, resolution.rel);
    } catch (error) {
      if (!res.headersSent) sendText(res, 500, "internal error: " + (error instanceof Error ? error.message : String(error)) + "\n");
      else res.destroy();
    }
  };
}
