import assert from "node:assert/strict";
import { describe, it } from "node:test";
import os from "node:os";
import { REDACTED, redact, redactDeep, redactUrl } from "./redact.js";

const HOME = "/home/tester";

describe("redact", () => {
  it("scrubs OpenAI keys of every shape", () => {
    const legacy = "sk-abcdefghijklmnopqrstuvwxyz012345";
    const modern = "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH";
    const project = "sk-proj-abc123DEF456ghi789JKL012mno345PQR";

    for (const key of [legacy, modern, project]) {
      const out = redact(`key is ${key} ok`);
      assert.equal(out, `key is ${REDACTED} ok`);
      assert.equal(out.includes(key), false);
    }
  });

  it("scrubs GitHub tokens", () => {
    const classic = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const oauth = "gho_ABCDEFGHIJ0123456789abcdefghijklmnop";
    const fineGrained = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789";

    assert.equal(redact(`token=${classic}`), `token=${REDACTED}`);
    assert.equal(redact(`token=${oauth}`), `token=${REDACTED}`);
    assert.equal(redact(`token=${fineGrained}`), `token=${REDACTED}`);
    assert.equal(redact(classic).includes("ghp_"), false);
  });

  it("scrubs a Slack bot token", () => {
    const token = "xox" + "b-" + "TESTONLY1234567890";
    const out = redact(`SLACK=${token}`);
    assert.equal(out, `SLACK=${REDACTED}`);
  });

  it("scrubs a Google API key", () => {
    const key = "AIzaSyA1234567890abcdefghijklmnopqrstu";
    const out = redact(`maps?key=${key}`);
    assert.equal(out, `maps?key=${REDACTED}`);
    assert.equal(out.includes("AIza"), false);
  });

  it("scrubs an AWS access key id", () => {
    const out = redact("creds AKIAIOSFODNN7EXAMPLE here");
    assert.equal(out, `creds ${REDACTED} here`);
  });

  it("scrubs a PEM private key block including the body", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEAv8Zx1rQ2p5T7yW0bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW",
      "xYzA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3xY4zA5b6C",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const out = redact(`before\n${pem}\nafter`);

    assert.equal(out, `before\n${REDACTED}\nafter`);
    assert.equal(out.includes("MIIEpAIBAAKCAQEA"), false);
    assert.equal(out.includes("BEGIN RSA PRIVATE KEY"), false);
  });

  it("scrubs an unterminated PEM block to the end without throwing", () => {
    const out = redact("-----BEGIN PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUA");
    assert.equal(out, REDACTED);
  });

  it("keeps the scheme for Authorization bearer headers", () => {
    const out = redact(`Authorization: Bearer ${"abc.DEF-123_456"}`);
    assert.equal(out, `Authorization: Bearer ${REDACTED}`);
    // Idempotent even though the replacement itself looks like a credential.
    assert.equal(redact(out), out);
  });

  it("drops userinfo from any scheme with an authority", () => {
    assert.equal(
      redact("remote https://alice:hunter2@example.com/repo.git"),
      `remote https://${REDACTED}@example.com/repo.git`,
    );
    assert.equal(
      redact("postgres://user:pw@db:5432/app"),
      `postgres://${REDACTED}@db:5432/app`,
    );
  });

  it("collapses the home directory to a tilde", () => {
    const opts = { home: HOME };
    assert.equal(redact(`${HOME}/code/roan/src`, opts), "~/code/roan/src");
    assert.equal(redact(`see ${HOME} alone`, opts), "see ~ alone");
    assert.equal(redact(`/tmp and ${HOME}/x`, opts), "/tmp and ~/x");
    // Default home, with no options at all.
    assert.equal(redact(`${os.homedir()}/x`), "~/x");
  });

  it("leaves a non-default home alone when one is passed", () => {
    const out = redact("/srv/app/data", { home: "/srv/app" });
    assert.equal(out, "~/data");
    assert.equal(redact(os.homedir() + "/x", { home: "/srv/app" }).includes(os.homedir()), true);
  });

  it("applies extra patterns", () => {
    const out = redact("pin 4711 and 0815", { extraPatterns: [/\b\d{4}\b/] });
    assert.equal(out, `pin ${REDACTED} and ${REDACTED}`);
  });

  it("accepts a non-global extra pattern and still replaces every match", () => {
    const out = redact("aXXbXXc", { extraPatterns: [/X+/] });
    assert.equal(out, `a${REDACTED}b${REDACTED}c`);
  });

  it("is idempotent", () => {
    const sample = [
      `home ${HOME}/x`,
      "-----BEGIN EC PRIVATE KEY-----\nA1B2C3D4\n-----END EC PRIVATE KEY-----",
      "Authorization: token ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH",
      "xox" + "b-" + "TESTONLY1234567890",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "AKIAIOSFODNN7EXAMPLE",
      "https://alice:hunter2@example.com/x?api_key=secret",
    ].join("\n");

    const once = redact(sample);
    const twice = redact(once);
    assert.equal(twice, once);
  });

  it("does not throw on very long input", () => {
    const long = `{"a":"sk-abcdefghijklmnopqrstuvwxyz012345","b":"${"x".repeat(500_000)}"}`;
    const out = redact(long);
    assert.equal(out.includes("sk-abcdefghijklmnopqrstuvwxyz012345"), false);
    assert.equal(out.length, long.length - "sk-abcdefghijklmnopqrstuvwxyz012345".length + REDACTED.length);
  });

  it("returns an empty string unchanged", () => {
    assert.equal(redact(""), "");
  });
});

describe("redactDeep", () => {
  it("redacts strings in a nested object with an array", () => {
    const input = {
      message: "using sk-abcdefghijklmnopqrstuvwxyz012345",
      count: 3,
      ok: true,
      missing: null,
      missingToo: undefined,
      nested: {
        path: `${HOME}/code`,
        list: ["ghp_1234567890abcdefghijklmnopqrstuvwxyz", 7, false],
      },
      at: new Date(0),
    };

    const out = redactDeep(input, { home: HOME });

    assert.equal(out.message, `using ${REDACTED}`);
    assert.equal(out.count, 3);
    assert.equal(out.ok, true);
    assert.equal(out.missing, null);
    assert.equal(out.missingToo, undefined);
    assert.equal(out.nested.path, "~/code");
    assert.deepEqual(out.nested.list, [REDACTED, 7, false]);
    assert.equal(out.at instanceof Date, true);
    assert.equal((out.at as Date).getTime(), 0);
  });

  it("never mutates the input", () => {
    const input = { a: "sk-abcdefghijklmnopqrstuvwxyz012345", b: { c: `${HOME}/x` } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;

    const out = redactDeep(input);

    assert.deepEqual(input, snapshot);
    assert.notEqual(out, input);
    assert.notEqual(out.b, input.b);
  });

  it("replaces a cycle with [circular] instead of hanging", () => {
    interface Node {
      name: string;
      self?: Node;
      list?: unknown[];
    }
    const root: Node = { name: `${HOME}/node` };
    root.self = root;
    root.list = [root];

    const out = redactDeep(root, { home: HOME });

    assert.equal(out.name, "~/node");
    assert.equal(out.self, "[circular]");
    assert.deepEqual(out.list, ["[circular]"]);
    assert.equal((out as { self?: Node }).self, "[circular]");
  });

  it("keeps a shared reference duplicated rather than marking it circular", () => {
    const shared = { value: "sk-abcdefghijklmnopqrstuvwxyz012345" };
    const out = redactDeep({ left: shared, right: shared });

    assert.deepEqual(out.left, { value: REDACTED });
    assert.deepEqual(out.right, { value: REDACTED });
  });

  it("passes primitives through", () => {
    assert.equal(redactDeep("sk-abcdefghijklmnopqrstuvwxyz012345"), REDACTED);
    assert.equal(redactDeep(42), 42);
    assert.equal(redactDeep(false), false);
    assert.equal(redactDeep(null), null);
    assert.equal(redactDeep(undefined), undefined);
  });
});

describe("redactUrl", () => {
  it("drops userinfo", () => {
    assert.equal(
      redactUrl("https://alice:hunter2@example.com/repo"),
      "https://example.com/repo",
    );
  });

  it("redacts a secret query value but keeps the name", () => {
    assert.equal(
      redactUrl("https://api.example.com/v1?api_key=abc123&page=2"),
      `https://api.example.com/v1?api_key=${REDACTED}&page=2`,
    );
  });

  it("covers token, secret, password and sig parameters", () => {
    const out = redactUrl(
      "https://x.example.com/p?token=1&client_secret=2&password=3&sig=4&keep=5",
    );
    assert.equal(
      out,
      `https://x.example.com/p?token=${REDACTED}&client_secret=${REDACTED}&password=${REDACTED}&sig=${REDACTED}&keep=5`,
    );
  });

  it("handles userinfo, query and fragment together", () => {
    assert.equal(
      redactUrl("https://u:p@host.example.com/a?access_token=zzz#frag"),
      `https://host.example.com/a?access_token=${REDACTED}#frag`,
    );
  });

  it("leaves a url without secrets intact", () => {
    const url = "https://example.com/a/b?page=2&sort=asc#top";
    assert.equal(redactUrl(url), url);
  });

  it("is idempotent", () => {
    const url = "https://alice:hunter2@example.com/x?api_key=abc&keep=1";
    const once = redactUrl(url);
    assert.equal(redactUrl(once), once);
  });
});
