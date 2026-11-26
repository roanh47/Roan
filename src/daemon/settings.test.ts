import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { RoanPaths } from "./paths.js";
import { loadSettings } from "./settings.js";
import { saveSettings } from "./settings-write.js";

let home = "";

before(() => {
  home = mkdtempSync(path.join(tmpdir(), "roan-settings-"));
});

after(() => {
  rmSync(home, { recursive: true, force: true });
});

function pathsAt(name: string): RoanPaths {
  const dir = path.join(home, name);
  mkdirSync(dir, { recursive: true });
  return {
    home: dir,
    secrets: path.join(dir, "secrets"),
    workspace: path.join(dir, "workspace"),
    syncedWorkspace: path.join(dir, "synced-workspace"),
    state: path.join(dir, "state"),
    database: path.join(dir, "state", "chain.db"),
    configFile: path.join(dir, "config.json"),
    identityFile: path.join(dir, "secrets", "identity.json"),
  };
}

describe("access.fullDisk setting", () => {
  it("defaults to off when there is no config", async () => {
    const settings = await loadSettings(pathsAt("empty"));
    assert.equal(settings.access.fullDisk, false);
  });

  it("reads a boolean true and ignores a string that looks like one", async () => {
    const on = pathsAt("on");
    writeFileSync(on.configFile, JSON.stringify({ access: { fullDisk: true } }));
    assert.equal((await loadSettings(on)).access.fullDisk, true);

    const stringly = pathsAt("stringly");
    writeFileSync(stringly.configFile, JSON.stringify({ access: { fullDisk: "true" } }));
    assert.equal((await loadSettings(stringly)).access.fullDisk, false);

    const numeric = pathsAt("numeric");
    writeFileSync(numeric.configFile, JSON.stringify({ access: { fullDisk: 1 } }));
    assert.equal((await loadSettings(numeric)).access.fullDisk, false);
  });

  it("survives a hand-edited config whose access field is nonsense", async () => {
    const paths = pathsAt("nonsense");
    writeFileSync(paths.configFile, JSON.stringify({ access: "yes please" }));
    assert.equal((await loadSettings(paths)).access.fullDisk, false);
  });

  it("round-trips through saveSettings and is not reset by an unrelated patch", async () => {
    const paths = pathsAt("roundtrip");
    const saved = await saveSettings(paths, { access: { fullDisk: true } });
    assert.equal(saved.access.fullDisk, true);

    const afterModel = await saveSettings(paths, { model: "another-model" });
    assert.equal(afterModel.access.fullDisk, true);
    assert.equal(afterModel.model, "another-model");

    const onDisk = JSON.parse(readFileSync(paths.configFile, "utf8")) as {
      access?: { fullDisk?: boolean };
    };
    assert.equal(onDisk.access?.fullDisk, true);
  });

  it("can turn the capability back off", async () => {
    const paths = pathsAt("off-again");
    await saveSettings(paths, { access: { fullDisk: true } });
    const off = await saveSettings(paths, { access: { fullDisk: false } });
    assert.equal(off.access.fullDisk, false);
  });

  it("rejects a non-boolean or unknown access key", async () => {
    const paths = pathsAt("reject");
    await assert.rejects(saveSettings(paths, { access: { fullDisk: "yes" } }), /must be a boolean/);
    await assert.rejects(saveSettings(paths, { access: { everything: true } }), /unknown access setting/);
    await assert.rejects(saveSettings(paths, { access: true }), /must be an object/);
  });
});
