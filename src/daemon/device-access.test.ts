import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadDeviceAccess, mayControl, mayLoadUi, saveDeviceAccess } from "./device-access.js";

const LOOPBACK = "127.0.0.1";
const TAILNET = "100.101.102.103";
const LAN = "192.168.1.20";

describe("device access", () => {
  it("is open by default and survives a missing or broken file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roan-access-"));
    try {
      assert.deepEqual(await loadDeviceAccess(dir), { deviceOnly: false });
      await writeFile(path.join(dir, "access.json"), "not json", "utf8");
      assert.deepEqual(await loadDeviceAccess(dir), { deviceOnly: false });
      await writeFile(path.join(dir, "access.json"), JSON.stringify({ deviceOnly: "true" }), "utf8");
      assert.deepEqual(await loadDeviceAccess(dir), { deviceOnly: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("remembers the switch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roan-access-"));
    try {
      assert.deepEqual(await saveDeviceAccess(dir, { deviceOnly: true }), { deviceOnly: true });
      assert.deepEqual(await loadDeviceAccess(dir), { deviceOnly: true });
      await saveDeviceAccess(dir, { deviceOnly: false });
      assert.deepEqual(await loadDeviceAccess(dir), { deviceOnly: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("open: this device and the tailnet control, everyone loads the UI", () => {
    const open = { deviceOnly: false };
    assert.equal(mayControl(open, LOOPBACK, false), true);
    assert.equal(mayControl(open, TAILNET, false), true);
    assert.equal(mayControl(open, LAN, false), false);
    assert.equal(mayControl(open, LAN, true), true);
    assert.equal(mayControl(open, undefined, false), false);
    assert.equal(mayLoadUi(open, LAN), true);
  });

  it("device only: nothing but loopback gets in, whatever the environment says", () => {
    const closed = { deviceOnly: true };
    assert.equal(mayControl(closed, LOOPBACK, false), true);
    assert.equal(mayControl(closed, TAILNET, true), false);
    assert.equal(mayControl(closed, LAN, true), false);
    assert.equal(mayLoadUi(closed, LOOPBACK), true);
    assert.equal(mayLoadUi(closed, TAILNET), false);
  });
});
