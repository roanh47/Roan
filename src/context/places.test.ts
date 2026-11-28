import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placesPrompt } from "./places.js";

const prompt = placesPrompt({
  home: "/home/roan/.Roan",
  workspace: "/home/roan/.Roan/workspace",
  syncedWorkspace: "/home/roan/.Roan/synced-workspace",
});

describe("where things go", () => {
  it("names the real paths of this device", () => {
    assert.ok(prompt.includes("Local workspace: /home/roan/.Roan/workspace"));
    assert.ok(prompt.includes("Synced workspace: /home/roan/.Roan/synced-workspace"));
    assert.ok(prompt.includes("Your own home: /home/roan/.Roan"));
  });

  it("says to build locally and to sync only what should be everywhere", () => {
    assert.match(prompt, /Build here/);
    assert.match(prompt, /Never build or install here/);
    assert.match(prompt, /only when it should be everywhere/);
  });

  it("keeps the home off limits and says how to change what is in it", () => {
    assert.match(prompt, /Do not create, change or delete files here/);
    assert.match(prompt, /SOUL\.md/);
    assert.match(prompt, /memory tool/);
    assert.match(prompt, /skill_propose/);
  });

  it("tells Roan to ask when it is not clear", () => {
    assert.match(prompt, /ask before you write/);
  });
});
