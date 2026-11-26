import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startControlServer } from "./control.js";
import { isLoopbackAddress, webDistFrom } from "./control-http.js";

const INDEX = "<!doctype html><title>roan</title><div id=app>shell</div>";
const APP_JS = "console.log('roan-asset');";

async function fixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "roan-dist-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), INDEX);
  await writeFile(join(root, "assets", "app.js"), APP_JS);
  await writeFile(join(root, "app.css"), "body{color:#000}");
  await writeFile(join(root, ".env"), "ROAN_TOKEN=never-served");
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** A GET with an exact path, no client-side normalisation. */
function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * A raw request line, because Node's http client would normalise a traversal
 * path before it ever reached the server. This is what an attacker sends.
 */
function rawGet(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n`));
    socket.on("data", (chunk: string) => {
      text += chunk;
    });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
    socket.setTimeout(3_000, () => {
      socket.destroy();
      resolve(text);
    });
  });
}

function server(webDist: string): Promise<Awaited<ReturnType<typeof startControlServer>>> {
  return startControlServer({
    port: 0,
    host: "127.0.0.1",
    webDist,
    store: () => null,
    state: () => ({ onboarding: true, chain: null, node: null, head: 0, peers: [], nodes: [], invite: null }) as never,
    onMessage: () => {},
    onCreate: () => Promise.resolve({ t: "chain", chain: "c", node: "n" } as never),
    onJoin: () => Promise.resolve({ t: "chain", chain: "c", node: "n" } as never),
  });
}

test("the built UI is served from the control port with real content types", async () => {
  const { root, cleanup } = await fixture();
  const control = await server(root);
  try {
    const index = await get(control.port, "/");
    assert.equal(index.status, 200);
    assert.match(String(index.headers["content-type"]), /^text\/html/);
    assert.match(index.body, /id=app/);

    const js = await get(control.port, "/assets/app.js");
    assert.equal(js.status, 200);
    assert.match(String(js.headers["content-type"]), /^text\/javascript/);
    assert.equal(js.body, APP_JS);

    const css = await get(control.port, "/app.css");
    assert.equal(css.status, 200);
    assert.match(String(css.headers["content-type"]), /^text\/css/);
  } finally {
    await control.close();
    await cleanup();
  }
});

test("an unknown route falls back to index.html, a missing asset is an honest 404", async () => {
  const { root, cleanup } = await fixture();
  const control = await server(root);
  try {
    const route = await get(control.port, "/settings/models");
    assert.equal(route.status, 200);
    assert.match(route.body, /id=app/, "client-side routing gets the shell");

    const missing = await get(control.port, "/assets/gone-1234.js");
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.body, /id=app/, "a missing bundle must not be answered with html");
  } finally {
    await control.close();
    await cleanup();
  }
});

test("traversal out of the dist root is refused, however it is spelled", async () => {
  const { root, cleanup } = await fixture();
  const control = await server(root);
  try {
    const spellings = [
      "/../../../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc%2fpasswd",
      "/assets/../../../../etc/passwd",
    ];
    for (const path of spellings) {
      const text = await rawGet(control.port, path);
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1] ?? 0);
      assert.ok(status === 403 || status === 404, `${path} answered ${String(status)}`);
      assert.doesNotMatch(text, /root:x?:0:0/, `${path} leaked the file system`);
    }
  } finally {
    await control.close();
    await cleanup();
  }
});

test("dotfiles are never served", async () => {
  const { root, cleanup } = await fixture();
  const control = await server(root);
  try {
    const env = await get(control.port, "/.env");
    assert.equal(env.status, 403);
    assert.doesNotMatch(env.body, /never-served/);

    const nested = await get(control.port, "/.git/config");
    assert.equal(nested.status, 403);
  } finally {
    await control.close();
    await cleanup();
  }
});

test("the bundled Android build has no file URL, and that must not be fatal", () => {
  // In the APK this module is one asset file: `import.meta.url` is not a file
  // URL, and resolving it threw "Invalid URL" before the daemon ever listened.
  const resolved = webDistFrom("android-asset:roan-daemon.js");
  assert.ok(resolved.endsWith("web/dist"), resolved);
  assert.ok(!resolved.includes("android-asset:"), resolved);
});

test("a real file URL still points next to the module", () => {
  const resolved = webDistFrom(new URL("file:///opt/roan/dist/daemon/control-http.js"));
  assert.equal(resolved, "/opt/roan/web/dist");
});
