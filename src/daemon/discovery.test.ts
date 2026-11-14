import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, startDiscovery, tailscaleHosts } from "./discovery.js";

/** Een nep-`tailscale` die precies zegt wat de test wil horen. */
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

test("leest de adressen uit tailscale status en slaat dit device over", async () => {
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

test("zonder Tailscale is de lijst leeg in plaats van een fout", async () => {
  process.env["ROAN_TAILSCALE_BIN"] = "/nonexistent/tailscale";
  const { self, hosts } = await tailscaleHosts();
  assert.equal(self, null);
  assert.deepEqual(hosts, []);
  delete process.env["ROAN_TAILSCALE_BIN"];
});

test("probe ziet of er iets op de poort luistert", async () => {
  const server = await listening();
  assert.equal(await probe("127.0.0.1", server.port), true);
  await server.close();
  assert.equal(await probe("127.0.0.1", server.port), false);
});

test("discovery biedt elk gevonden adres één keer aan", async () => {
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
