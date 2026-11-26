import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALLOWLIST, buildRequest, frameFor } from "../sync/device-control.js";
import { parseFrame } from "./parse.js";

const CHAIN = "gesprek";
const ME = "desktop";

function wire(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ t: "device_req", chain: CHAIN, node: ME, command: "uptime", ...extra });
}

describe("device_req frame", () => {
  it("parses into exactly the allowlisted request", () => {
    const parsed = parseFrame(wire());
    assert.equal(parsed.ok, true, `frame was refused: ${parsed.ok ? "" : parsed.reason}`);
    if (!parsed.ok) return;
    assert.equal(parsed.frame.t, "device_req");
    if (parsed.frame.t !== "device_req") return;
    assert.equal(parsed.frame.chain, CHAIN);
    assert.equal(parsed.frame.node, ME);
    assert.equal(parsed.frame.command, "uptime");
    assert.deepEqual(Object.keys(parsed.frame).sort(), ["chain", "command", "node", "t"]);
  });

  it("round-trips every allowlisted command through frameFor", () => {
    for (const entry of ALLOWLIST) {
      const built = buildRequest(ME, entry.command, { chain: CHAIN });
      assert.equal(built.ok, true, `build refused "${entry.command}"`);
      if (!built.ok) continue;

      const frame = frameFor(built.request, CHAIN);
      assert.deepEqual(Object.keys(frame).sort(), ["chain", "command", "node", "t"]);
      assert.equal(frame.node, ME, "the addressed node travels in the frame");
      assert.equal(frame.command, entry.command);

      const parsed = parseFrame(JSON.stringify(frame));
      assert.equal(parsed.ok, true, `parse refused "${entry.command}": ${parsed.ok ? "" : parsed.reason}`);
      if (!parsed.ok) continue;
      assert.deepEqual(parsed.frame, frame);
    }
  });

  it("drops an unknown extra field instead of carrying it on", () => {
    const parsed = parseFrame(wire({ note: "hello", runAs: "root" }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.frame.t !== "device_req") return;
    assert.equal("note" in parsed.frame, false);
    assert.equal("runAs" in parsed.frame, false);
  });

  it("accepts a frame whose argv is exactly the allowlisted one", () => {
    const parsed = parseFrame(wire({ argv: ["uptime"] }));
    assert.equal(parsed.ok, true);
  });

  it("refuses a frame that is not JSON", () => {
    assert.deepEqual(parseFrame("{nope"), { ok: false, reason: "invalid JSON" });
  });

  it("refuses a missing chain, node or command", () => {
    for (const extra of [
      { chain: undefined },
      { chain: "" },
      { chain: "   " },
      { chain: 7 },
      { node: undefined },
      { node: "" },
      { node: 7 },
      { command: undefined },
      { command: "" },
      { command: "   " },
      { command: 7 },
    ]) {
      const parsed = parseFrame(wire(extra));
      assert.equal(parsed.ok, false, `accepted ${JSON.stringify(extra)}`);
    }
  });

  it("refuses a command outside the allowlist and shell trickery", () => {
    for (const command of ["rm -rf /", "cargo build", "uptime; rm -rf /", "uptime && id", "uptime | sh", "uptime > /tmp/x", "$(id)", "`id`"]) {
      const parsed = parseFrame(wire({ command }));
      assert.equal(parsed.ok, false, `accepted "${command}"`);
      if (parsed.ok) continue;
      assert.ok(parsed.reason.length > 0);
    }
  });

  it("refuses a tampered argv", () => {
    for (const argv of [["uptime", "--all"], ["sh", "-c", "uptime"], ["uptime", 1], "uptime", [""]]) {
      const parsed = parseFrame(wire({ argv }));
      assert.equal(parsed.ok, false, `accepted argv ${JSON.stringify(argv)}`);
    }
  });
});
