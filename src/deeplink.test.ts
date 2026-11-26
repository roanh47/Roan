import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeepLink,
  MAX_TEXT_LENGTH,
  parseDeepLink,
  SETTINGS_PAGES,
  type DeepLink,
  type SettingsPage,
} from "./deeplink.js";

/**
 * Deep links: the three shapes the OS may hand the app, the builder that makes
 * them, and the rejections that keep a stray url from opening something the
 * user did not ask for.
 */

function parsed(input: string): DeepLink {
  const result = parseDeepLink(input);
  assert.equal(result.ok, true, `expected ${input} to parse, got ${result.ok ? "" : result.error}`);
  if (!result.ok) throw new Error("unreachable");
  return result.link;
}

function rejected(input: string): string {
  const result = parseDeepLink(input);
  assert.equal(result.ok, false, `expected ${input} to be refused`);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.error.length > 0, "a refusal must say what is wrong");
  return result.error;
}

function roundTrip(link: DeepLink): DeepLink {
  return parsed(buildDeepLink(link));
}

describe("parseDeepLink", () => {
  it("opens a conversation", () => {
    assert.deepEqual(parsed("roan://session/0b1c2d3e"), { kind: "session", params: { id: "0b1c2d3e" } });
  });

  it("opens a conversation whose id was percent-encoded", () => {
    assert.deepEqual(parsed("roan://session/my%2Did"), { kind: "session", params: { id: "my-id" } });
  });

  it("takes the scheme and host case-insensitively, like any url", () => {
    assert.deepEqual(parsed("ROAN://Session/abc"), { kind: "session", params: { id: "abc" } });
  });

  it("decodes a chat text, spaces and ampersands included", () => {
    assert.deepEqual(parsed("roan://chat?text=hello+world%20%26%20bye"), {
      kind: "chat",
      params: { text: "hello world & bye" },
    });
  });

  it("carries a target conversation with the chat text", () => {
    assert.deepEqual(parsed("roan://chat?text=hi&session=s1"), {
      kind: "chat",
      params: { text: "hi", session: "s1" },
    });
  });

  it("keeps a multi-line text intact", () => {
    assert.deepEqual(parsed("roan://chat?text=one%0Atwo"), { kind: "chat", params: { text: "one\ntwo" } });
  });

  it("opens every known settings page", () => {
    for (const page of SETTINGS_PAGES) {
      assert.deepEqual(parsed(`roan://settings/${page}`), { kind: "settings", params: { page } });
    }
  });

  it("refuses another scheme", () => {
    assert.match(rejected("https://example.com/session/abc"), /starts with roan:\/\//);
    assert.match(rejected("roanx://session/abc"), /starts with roan:\/\//);
  });

  it("refuses a link that is not a url at all", () => {
    assert.match(rejected("not a url"), /not a valid url/);
    assert.match(rejected(""), /not a valid url/);
  });

  it("refuses an unknown host, and a link with none", () => {
    assert.match(rejected("roan://join?code=x"), /unknown Roan link host "join"/);
    assert.match(rejected("roan://panel/providers"), /unknown Roan link host "panel"/);
    assert.match(rejected("roan:session/abc"), /needs a host/);
  });

  it("refuses a session link without an id or with extra segments", () => {
    assert.match(rejected("roan://session"), /needs an id/);
    assert.match(rejected("roan://session/"), /needs an id/);
    assert.match(rejected("roan://session/abc/extra"), /2 path segments/);
    assert.match(rejected("roan://session/abc/"), /2 path segments/);
  });

  it("refuses a session link that carries a query", () => {
    assert.match(rejected("roan://session/abc?x=1"), /takes no query parameters/);
  });

  it("refuses a session id with characters that would not survive the trip", () => {
    assert.match(rejected("roan://session/..%2Fetc"), /may only use letters/);
    assert.match(rejected("roan://session/-flag"), /must not start with \. or -/);
    assert.match(rejected("roan://session/a%20b"), /may only use letters/);
  });

  it("refuses a path that is not valid percent-encoding", () => {
    assert.match(rejected("roan://session/%zz"), /not valid percent-encoding/);
  });

  it("refuses a chat link with no text, a blank text, or a duplicate", () => {
    assert.match(rejected("roan://chat"), /needs a text/);
    assert.match(rejected("roan://chat?text="), /non-blank text/);
    assert.match(rejected("roan://chat?text=%20%20"), /non-blank text/);
    assert.match(rejected("roan://chat?text=a&text=b"), /given twice/);
  });

  it("refuses a chat text that is too long or carries a control character", () => {
    const long = "x".repeat(MAX_TEXT_LENGTH + 1);
    assert.match(rejected(`roan://chat?text=${long}`), /longer than 20000/);
    assert.match(rejected("roan://chat?text=a%00b"), /control character/);
    assert.match(rejected("roan://chat?text=a%07b"), /control character/);
  });

  it("refuses an unknown or repeated chat parameter", () => {
    assert.match(rejected("roan://chat?text=hi&model=x"), /unknown link parameter "model"/);
    assert.match(rejected("roan://chat?text=hi&session=a&session=b"), /given twice/);
  });

  it("refuses a chat link with a path", () => {
    assert.match(rejected("roan://chat/abc?text=hi"), /no path/);
  });

  it("refuses a session in a chat link that is not an id", () => {
    assert.match(rejected("roan://chat?text=hi&session=/etc"), /session id may only use letters/);
  });

  it("refuses an unknown settings page", () => {
    assert.match(rejected("roan://settings/secrets"), /unknown settings page "secrets"/);
    assert.match(rejected("roan://settings"), /needs a page/);
    assert.match(rejected("roan://settings/providers/about"), /2 path segments/);
    assert.match(rejected("roan://settings/providers?tab=keys"), /takes no query parameters/);
  });

  it("refuses a fragment, which no shape uses", () => {
    assert.match(rejected("roan://settings/providers#top"), /takes no fragment/);
  });
});

describe("buildDeepLink", () => {
  it("writes the three shapes as documented", () => {
    assert.equal(buildDeepLink({ kind: "session", params: { id: "abc" } }), "roan://session/abc");
    assert.equal(buildDeepLink({ kind: "chat", params: { text: "hi there" } }), "roan://chat?text=hi+there");
    assert.equal(buildDeepLink({ kind: "settings", params: { page: "devices" } }), "roan://settings/devices");
  });

  it("encodes a text so it cannot change the link's shape", () => {
    const text = "a&session=evil #1 100% +2";
    const link = buildDeepLink({ kind: "chat", params: { text } });
    assert.deepEqual(roundTrip({ kind: "chat", params: { text } }), { kind: "chat", params: { text } });
    assert.ok(!link.includes("&session=evil"), link);
  });

  it("encodes an id so it stays one path segment", () => {
    const id = "id.with:odd_Chars-9";
    assert.equal(buildDeepLink({ kind: "session", params: { id } }), "roan://session/id.with%3Aodd_Chars-9");
    assert.deepEqual(roundTrip({ kind: "session", params: { id } }), { kind: "session", params: { id } });
  });

  it("refuses to build a link that would not parse", () => {
    assert.throws(() => buildDeepLink({ kind: "session", params: { id: "" } }), /cannot be empty/);
    assert.throws(() => buildDeepLink({ kind: "session", params: { id: "a/b" } }), /may only use letters/);
    assert.throws(() => buildDeepLink({ kind: "chat", params: { text: "   " } }), /non-blank/);
    assert.throws(() => buildDeepLink({ kind: "chat", params: { text: "a\u0000b" } }), /control character/);
    assert.throws(
      () => buildDeepLink({ kind: "chat", params: { text: "hi", session: "-x" } }),
      /must not start with \. or -/,
    );
    assert.throws(
      () => buildDeepLink({ kind: "settings", params: { page: "secrets" as unknown as SettingsPage } }),
      /unknown settings page/,
    );
  });
});

describe("round trip", () => {
  const links: DeepLink[] = [
    { kind: "session", params: { id: "0b1c2d3e-4f5a" } },
    { kind: "session", params: { id: "s" } },
    { kind: "chat", params: { text: "hello" } },
    { kind: "chat", params: { text: "hello", session: "s1" } },
    { kind: "chat", params: { text: "  spaces kept  " } },
    { kind: "chat", params: { text: "line one\nline two\ttab" } },
    { kind: "chat", params: { text: "emoji 🚀 and ünïcode" } },
    { kind: "chat", params: { text: "? # & = % + / \\ <tag>" } },
    ...SETTINGS_PAGES.map((page): DeepLink => ({ kind: "settings", params: { page } })),
  ];

  for (const link of links) {
    it(`survives ${buildDeepLink(link)}`, () => {
      assert.deepEqual(roundTrip(link), link);
      assert.equal(buildDeepLink(roundTrip(link)), buildDeepLink(link));
    });
  }
});
