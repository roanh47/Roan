import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatJoinLink, parseJoinLink, type JoinLinkPayload } from "./deeplink.js";

const EXPIRES_MS = Date.UTC(2027, 0, 2, 3, 4, 5, 678);

function validPayload(): JoinLinkPayload {
  return {
    code: "ABCD1234",
    chainId: "chain-01",
    expiresAt: new Date(EXPIRES_MS),
  };
}

function messageOf(error: unknown): string {
  assert.equal(error instanceof Error, true);
  return (error as Error).message;
}

describe("parseJoinLink", () => {
  it("parses a well-formed link", () => {
    const parsed = parseJoinLink(
      "roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T03:04:05.678Z",
    );

    assert.equal(parsed.code, "ABCD1234");
    assert.equal(parsed.chainId, "chain-01");
    assert.equal(parsed.expiresAt.getTime(), EXPIRES_MS);
  });

  it("ignores extra query parameters", () => {
    const parsed = parseJoinLink(
      "roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T03:04:05.678Z&tailnet=x&utm=qr",
    );

    assert.deepEqual(parsed, validPayload());
  });

  it("accepts an ISO 8601 timestamp with a numeric offset", () => {
    const parsed = parseJoinLink(
      "roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T04:04:05%2B01:00",
    );

    assert.equal(parsed.expiresAt.getTime(), EXPIRES_MS - 678);
  });

  it("rejects a non-string input naming the type", () => {
    assert.throws(
      () => parseJoinLink(42 as unknown as string),
      (error: unknown) => /join link must be a string, got number/.test(messageOf(error)),
    );
    assert.throws(
      () => parseJoinLink(null as unknown as string),
      (error: unknown) => /join link must be a string, got object/.test(messageOf(error)),
    );
  });

  it("rejects a string that is not a URL", () => {
    assert.throws(() => parseJoinLink("definitely not a link"), /not a valid URL/);
  });

  it("rejects the wrong scheme", () => {
    assert.throws(
      () => parseJoinLink("https://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T03:04:05Z"),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/scheme must be "roan"/.test(message), true);
        assert.equal(message.includes("https"), true);
        return true;
      },
    );
  });

  it("rejects the wrong host", () => {
    assert.throws(
      () =>
        parseJoinLink("roan://pair?code=ABCD1234&chain=chain-01&expires=2027-01-02T03:04:05Z"),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/host must be "join"/.test(message), true);
        assert.equal(message.includes("pair"), true);
        return true;
      },
    );
  });

  it("names the missing parameter for each required parameter", () => {
    const base = "roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T03:04:05Z";

    assert.throws(() => parseJoinLink(base.replace("code=ABCD1234", "")), /"code"/);
    assert.throws(() => parseJoinLink(base.replace("chain=chain-01", "")), /"chain"/);
    assert.throws(
      () => parseJoinLink(base.replace("expires=2027-01-02T03:04:05Z", "")),
      /"expires"/,
    );
  });

  it("reports a missing parameter, not an empty one", () => {
    assert.throws(
      () => parseJoinLink("roan://join?chain=chain-01&expires=2027-01-02T03:04:05Z"),
      /missing required parameter "code"/,
    );
  });

  it("rejects a code shorter than 8 characters without echoing it", () => {
    assert.throws(
      () =>
        parseJoinLink("roan://join?code=ABC1234&chain=chain-01&expires=2027-01-02T03:04:05Z"),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/parameter "code" must be at least 8 characters/.test(message), true);
        assert.equal(message.includes("ABC1234"), false);
        return true;
      },
    );
  });

  it("rejects an empty chain id", () => {
    assert.throws(
      () => parseJoinLink("roan://join?code=ABCD1234&chain=&expires=2027-01-02T03:04:05Z"),
      /parameter "chain" must be a non-empty id/,
    );
  });

  it("rejects an unparseable expires value", () => {
    assert.throws(
      () => parseJoinLink("roan://join?code=ABCD1234&chain=chain-01&expires=tomorrow"),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/parameter "expires" must be an ISO 8601 timestamp/.test(message), true);
        assert.equal(message.includes("tomorrow"), true);
        return true;
      },
    );
  });

  it("rejects a date-only expires value", () => {
    assert.throws(
      () => parseJoinLink("roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02"),
      /parameter "expires" must be an ISO 8601 timestamp/,
    );
  });
});

describe("formatJoinLink", () => {
  it("builds a roan://join link", () => {
    const link = formatJoinLink(validPayload());

    assert.equal(
      link,
      "roan://join?code=ABCD1234&chain=chain-01&expires=2027-01-02T03%3A04%3A05.678Z",
    );
  });

  it("round-trips through parseJoinLink", () => {
    const payload = validPayload();

    assert.deepEqual(parseJoinLink(formatJoinLink(payload)), payload);
  });

  it("URL-encodes values and still round-trips", () => {
    const payload: JoinLinkPayload = {
      code: "AB CD+EF/G",
      chainId: "chain 01+2 & more",
      expiresAt: new Date(EXPIRES_MS),
    };

    const link = formatJoinLink(payload);
    assert.equal(link.includes(" "), false);
    assert.equal(link.includes("%2B"), true);
    assert.deepEqual(parseJoinLink(link), payload);
  });

  it("rejects a payload it could not parse back", () => {
    assert.throws(
      () => formatJoinLink({ ...validPayload(), code: "SHORT" }),
      /parameter "code" must be at least 8 characters/,
    );
    assert.throws(
      () => formatJoinLink({ ...validPayload(), chainId: "  " }),
      /parameter "chain" must be a non-empty id/,
    );
    assert.throws(
      () => formatJoinLink({ ...validPayload(), expiresAt: new Date(Number.NaN) }),
      /parameter "expires" must be a valid Date/,
    );
  });
});
