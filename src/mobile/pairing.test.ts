import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { decodePairing, encodePairing, type PairingPayload } from "./pairing.js";

const NOW = 1_760_000_000_000;

function validPayload(): PairingPayload {
  return {
    code: "ABCD1234",
    tailnetName: "roan.tailnet.example.ts.net",
    chainId: "chain-01",
    expiresAt: NOW + 60_000,
  };
}

/** Hand-encode arbitrary JSON so tests can build payloads encodePairing would reject. */
function tokenFromJson(json: string): string {
  return Buffer.from(json, "utf8").toString("base64url");
}

function messageOf(error: unknown): string {
  assert.equal(error instanceof Error, true);
  return (error as Error).message;
}

describe("encodePairing / decodePairing", () => {
  it("round-trips a payload", () => {
    const payload = validPayload();

    const token = encodePairing(payload);
    const decoded = decodePairing(token, NOW);

    assert.deepEqual(decoded, payload);
  });

  it("emits url-safe base64 without padding", () => {
    const token = encodePairing(validPayload());

    assert.equal(/^[A-Za-z0-9_-]+$/.test(token), true);
    assert.equal(token.includes("="), false);
    assert.equal(token.includes("+"), false);
    assert.equal(token.includes("/"), false);
  });

  it("ignores unknown extra fields in the JSON", () => {
    const json = JSON.stringify({ ...validPayload(), extra: "ignored", nested: { a: 1 } });

    assert.deepEqual(decodePairing(tokenFromJson(json), NOW), validPayload());
  });

  it("rejects a code shorter than 8 characters on encode", () => {
    const payload = { ...validPayload(), code: "ABCD123" };

    assert.throws(() => encodePairing(payload), (error: unknown) =>
      /pairing code must be at least 8 characters/.test(messageOf(error)),
    );
  });

  it("rejects an expired token", () => {
    const payload = { ...validPayload(), expiresAt: NOW - 1 };

    const token = encodePairing(payload);

    assert.throws(() => decodePairing(token, NOW), (error: unknown) => {
      const message = messageOf(error);
      assert.equal(message.includes("expired"), true);
      assert.equal(message.includes(String(payload.expiresAt)), true);
      assert.equal(message.includes(token), false);
      return true;
    });
  });

  it("rejects a garbage string as not decodable", () => {
    assert.throws(() => decodePairing("not a pairing token!!", NOW), (error: unknown) =>
      /not decodable/.test(messageOf(error)),
    );
  });

  it("rejects base64url that is not JSON as not decodable", () => {
    assert.throws(() => decodePairing(tokenFromJson("plain text"), NOW), (error: unknown) =>
      /not decodable/.test(messageOf(error)),
    );
  });

  it("names the missing field when the JSON lacks chainId", () => {
    const { chainId: _chainId, ...withoutChainId } = validPayload();
    const token = tokenFromJson(JSON.stringify(withoutChainId));

    assert.throws(() => decodePairing(token, NOW), (error: unknown) =>
      /missing required field "chainId"/.test(messageOf(error)),
    );
  });

  it("rejects an empty tailnetName on encode", () => {
    const payload = { ...validPayload(), tailnetName: "  " };

    assert.throws(() => encodePairing(payload), /tailnetName must be a non-empty string/);
  });

  it("rejects a non-finite expiresAt on encode", () => {
    const payload = { ...validPayload(), expiresAt: Number.NaN };

    assert.throws(() => encodePairing(payload), /expiresAt must be a finite unix-ms timestamp/);
  });
});
