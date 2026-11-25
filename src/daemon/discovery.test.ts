import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, startDiscovery, tailscaleHosts } from "./discovery.js";

/** A fake `tailscale` that says exactly what the test wants to hear. */
function fakeTailscale(payload: unknown, exitCode = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "roan-ts-"));
  const file = join(dir, "tailscale");
  writeFileSync(file, `#!/bin/sh\necho '${JSON.stringify(payload)}'\nexit ${exitCode}\n`);
  chmodSync(file, 0o755);
  return file;
}

async function listening(port = 0): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actual = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port: actual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("reads the addresses from tailscale status and skips this device", async () => {
  process.env["ROAN_TAILSCALE_BIN"] = fakeTailscale({
    Self: { TailscaleIPs: ["100.64.0.1", "fd7a::1"] },
    Peer: {
      pc: { TailscaleIPs: ["100.64.0.2"], Online: true },
      mac: { TailscaleIPs: ["100.64.0.3"], Online: true },
      uit: { TailscaleIPs: ["100.64.0.4"], Online: false },
    },
  });
  const { self, hosts } = await tailscaleHosts();
  assert.equal(self, "100.64.0.1");
  assert.deepEqual(hosts, ["100.64.0.2", "100.64.0.3"]);
  delete process.env["ROAN_TAILSCALE_BIN"];
});

test("without Tailscale the list is empty instead of an error", async () => {
  process.env["ROAN_TAILSCALE_BIN"] = "/nonexistent/tailscale";
  const { self, hosts } = await tailscaleHosts();
  assert.equal(self, null);
  assert.deepEqual(hosts, []);
  delete process.env["ROAN_TAILSCALE_BIN"];
});

test("probe sees whether something is listening on the port", async () => {
  const server = await listening();
  assert.equal(await probe("127.0.0.1", server.port), true);
  await server.close();
  assert.equal(await probe("127.0.0.1", server.port), false);
});

test("discovery offers every found address once", async () => {
  const server = await listening();
  process.env["ROAN_TAILSCALE_BIN"] = fakeTailscale({
    Self: { TailscaleIPs: ["100.64.0.1"] },
    Peer: { deze: { TailscaleIPs: ["127.0.0.1"], Online: true } },
  });

  const seen: string[] = [];
  const stop = startDiscovery({ port: server.port, intervalMs: 60_000, onCandidate: (host) => seen.push(host) });
  for (let i = 0; i < 100 && seen.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  stop();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await server.close();
  delete process.env["ROAN_TAILSCALE_BIN"];

  assert.deepEqual(seen, ["127.0.0.1"]);
});
