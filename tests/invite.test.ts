import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInvite,
  DEFAULT_INVITE_TTL_MS,
  InviteError,
  parseInvite,
  type InviteErrorCode,
} from "../src/sync/invite.js";

const NOW = 1_700_000_000_000;

function input(overrides: Partial<Parameters<typeof createInvite>[0]> = {}) {
  return { chain: "chain-abc", host: "192.168.1.20", port: 47821, ...overrides };
}

/** Runs `fn`, requires an InviteError with `code`, and returns it. */
function fails(code: InviteErrorCode, fn: () => unknown): InviteError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof InviteError, `expected InviteError, got ${String(error)}`);
    assert.equal(error.code, code, `expected code "${code}", got "${error.code}": ${error.message}`);
    return error;
  }
  assert.fail(`expected an InviteError with code "${code}", but nothing was thrown`);
}

/** Swaps one payload character for a different valid base32 character. */
function corrupt(code: string): string {
  const parts = code.split(".");
  const payload = parts[1] ?? "";
  const index = Math.floor(payload.length / 2);
  const current = payload[index] ?? "0";
  const replacement = current === "0" ? "1" : "0";
  parts[1] = payload.slice(0, index) + replacement + payload.slice(index + 1);
  return parts.join(".");
}

describe("createInvite", () => {
  it("mints a code that parseInvite reads back unchanged", () => {
    const code = createInvite(input(), NOW);
    const invite = parseInvite(code, NOW + 1000);

    assert.equal(invite.v, 1);
    assert.equal(invite.chain, "chain-abc");
    assert.equal(invite.host, "192.168.1.20");
    assert.equal(invite.port, 47821);
    assert.equal(invite.issuedAt, NOW);
    assert.equal(invite.expiresAt, NOW + DEFAULT_INVITE_TTL_MS);
  });

  it("honours a custom ttl", () => {
    const code = createInvite(input({ ttlMs: 60_000 }), NOW);
    assert.equal(parseInvite(code, NOW).expiresAt, NOW + 60_000);
  });

  it("is deterministic for the same input and clock", () => {
    assert.equal(createInvite(input(), NOW), createInvite(input(), NOW));
    assert.notEqual(createInvite(input(), NOW), createInvite(input({ chain: "other" }), NOW));
  });

  it("emits the documented three-part shape", () => {
    const code = createInvite(input(), NOW);
    assert.match(code, /^ROAN1\.[0-9A-HJKMNP-TV-Z]+\.[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it("refuses input that cannot describe a chain", () => {
    fails("invalid", () => createInvite(input({ chain: "   " })));
    fails("invalid", () => createInvite(input({ host: "" })));
    fails("invalid", () => createInvite(input({ port: 0 })));
    fails("invalid", () => createInvite(input({ port: 70000 })));
    fails("invalid", () => createInvite(input({ port: 12.5 })));
    fails("invalid", () => createInvite(input({ ttlMs: 0 })));
    fails("invalid", () => createInvite(input({ ttlMs: -1 })));
  });
});

describe("parseInvite", () => {
  it("accepts lowercase, spaces and hyphens", () => {
    const code = createInvite(input(), NOW);
    const typed = code.toLowerCase().replace(/\./g, " . ").replace("roan1", "ro-an1");
    assert.deepEqual(parseInvite(typed, NOW), parseInvite(code, NOW));
  });

  it("tolerates surrounding whitespace", () => {
    const code = createInvite(input(), NOW);
    assert.equal(parseInvite(`\n\t ${code} \n`, NOW).chain, "chain-abc");
  });

  it("reports a mistyped character as a checksum failure, not malformed", () => {
    const code = createInvite(input(), NOW);
    const error = fails("checksum", () => parseInvite(corrupt(code), NOW));
    assert.match(error.message, /checksum/);
    assert.match(error.message, /mistyped/);
  });

  it("reports an expiry as expired and names the moment", () => {
    const code = createInvite(input({ ttlMs: 60_000 }), NOW);
    const error = fails("expired", () => parseInvite(code, NOW + 60_000));
    assert.match(error.message, new RegExp(new Date(NOW + 60_000).toISOString().replace(/\./g, "\\.")));
  });

  it("still parses one millisecond before expiry", () => {
    const code = createInvite(input({ ttlMs: 60_000 }), NOW);
    assert.equal(parseInvite(code, NOW + 59_999).chain, "chain-abc");
  });

  it("rejects codes from another format version with their own error", () => {
    const code = createInvite(input(), NOW);
    fails("version", () => parseInvite(code.replace("ROAN1.", "ROAN2."), NOW));
  });

  it("rejects strings that are not codes at all", () => {
    fails("malformed", () => parseInvite("", NOW));
    fails("malformed", () => parseInvite("   ", NOW));
    fails("malformed", () => parseInvite("hello world", NOW));
    fails("malformed", () => parseInvite("ROAN1.onlyonepart", NOW));
    fails("malformed", () => parseInvite("ROAN1.AAAA.BBBB.CCCC", NOW));
    fails("malformed", () => parseInvite("JOIN1.AAAA.BBBBBBBB", NOW));
  });

  it("rejects an invalid character in the payload as malformed", () => {
    const code = createInvite(input(), NOW);
    const parts = code.split(".");
    // "U" is deliberately absent from the Crockford alphabet.
    fails("malformed", () => parseInvite(`${parts[0]}.${parts[1]}U.${parts[2]}`, NOW));
  });

  it("rejects a checksum of the wrong length as malformed", () => {
    const code = createInvite(input(), NOW);
    const parts = code.split(".");
    fails("malformed", () => parseInvite(`${parts[0]}.${parts[1]}.${parts[2]?.slice(0, 4)}`, NOW));
  });

  it("uses a distinct error code for every failure kind", () => {
    const code = createInvite(input({ ttlMs: 1 }), NOW);
    const codes = [
      fails("malformed", () => parseInvite("nope", NOW)).code,
      fails("version", () => parseInvite(code.replace("ROAN1.", "ROAN9."), NOW)).code,
      fails("checksum", () => parseInvite(corrupt(code), NOW)).code,
      fails("invalid", () => createInvite(input({ port: 0 }))).code,
      fails("expired", () => parseInvite(code, NOW + 1)).code,
    ];
    assert.deepEqual(codes, ["malformed", "version", "checksum", "invalid", "expired"]);
    assert.equal(new Set(codes).size, codes.length);
  });
});
