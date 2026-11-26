import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frameFor, type DeviceRequest } from "../sync/device-control.js";
import { decodeFrame, encodeFrame } from "./codec.js";
import {
  PROTOCOL_VERSION,
  type DeviceRequestFrame,
  type Event,
  type EventType,
} from "./types.js";
import { ProtocolError, isEventType, isFrame, isFrameType, validateEvent, validateFrame } from "./validate.js";

const CHAIN = "gesprek";
const ME = "desktop";

function frame(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: "device_req", chain: CHAIN, node: ME, command: "df -h", ...extra };
}

function event(type: EventType, data: unknown): Event {
  return { v: PROTOCOL_VERSION, chain: CHAIN, seq: 1, id: `${type}-1`, node: "owner", ts: 1, type, data };
}

describe("device_req in the frozen contract", () => {
  it("is a known frame type", () => {
    assert.equal(isFrameType("device_req"), true);
    assert.equal(isFrameType("device_request"), false);
  });

  it("validates a well-formed frame and drops unknown fields", () => {
    const validated = validateFrame(frame({ note: "ignored" }));
    assert.deepEqual(validated, { t: "device_req", chain: CHAIN, node: ME, command: "df -h" });
    assert.equal(isFrame(validated), true);
  });

  it("refuses an empty chain, node or command", () => {
    for (const extra of [
      { chain: "" },
      { chain: "  " },
      { chain: undefined },
      { node: "" },
      { node: undefined },
      { command: "" },
      { command: "  " },
      { command: undefined },
    ]) {
      assert.throws(
        () => validateFrame(frame(extra)),
        (error: unknown) => error instanceof ProtocolError && error.code === "invalid_frame",
        `accepted ${JSON.stringify(extra)}`,
      );
    }
  });

  it("refuses a frame that ships its own argv", () => {
    assert.throws(
      () => validateFrame(frame({ argv: ["df", "-h"] })),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "invalid_frame");
        assert.match(error.message, /\.argv/);
        return true;
      },
    );
  });

  it("is unversioned: no `v` is required and a stray one is not consulted", () => {
    const validated = validateFrame(frame());
    assert.equal("v" in validated, false);
    const decoded = decodeFrame(JSON.stringify(frame({ v: 99 })));
    assert.equal(decoded.t, "device_req");
  });

  it("survives a codec round-trip", () => {
    const request: DeviceRequest = { node: ME, command: "uptime", argv: ["uptime"], chain: CHAIN };
    const deviceFrame: DeviceRequestFrame = { ...frameFor(request, CHAIN) };
    const text = encodeFrame(deviceFrame);
    assert.deepEqual(decodeFrame(text), { t: "device_req", chain: CHAIN, node: ME, command: "uptime" });
    assert.equal(text.includes("argv"), false, "the argv never goes on the wire");
  });
});

describe("device event types", () => {
  it("knows device_grant and device_result", () => {
    assert.equal(isEventType("device_grant"), true);
    assert.equal(isEventType("device_result"), true);
    assert.equal(isEventType("device_control"), false);
  });

  it("accepts a grant payload", () => {
    const validated = validateEvent(event("device_grant", { node: "laptop", enabled: true }));
    assert.deepEqual(validated.data, { node: "laptop", enabled: true });
  });

  it("accepts an accepted and a refused device_result payload", () => {
    const accepted = validateEvent(
      event("device_result", { node: ME, command: "uptime", accepted: true, output: "up 3 days" }),
    );
    assert.equal((accepted.data as { accepted: boolean }).accepted, true);

    const refused = validateEvent(
      event("device_result", {
        node: ME,
        command: "uptime",
        accepted: false,
        reason: "device control: there is no grant for that node",
      }),
    );
    assert.equal((refused.data as { accepted: boolean }).accepted, false);
  });
});
