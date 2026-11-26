import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkAndPrepareUpdate } from "./update-flow.js";
import { UpdateFeedError } from "./update-feed.js";

/**
 * The full chain in one call: latest.json text -> typed entry -> version
 * decision -> download -> digest check -> installer path. `fetch` is injected
 * so both the feed and the bundle come from memory; no socket is opened.
 */

const BUNDLE_TEXT = "verified bundle bytes\n";
const BUNDLE_BYTES = Buffer.from(BUNDLE_TEXT, "utf8");
const BUNDLE_SHA256 = createHash("sha256").update(BUNDLE_BYTES).digest("hex");

const FEED_URL = "https://updates.example.invalid/latest.json";
const BUNDLE_URL = "https://updates.example.invalid/Roan-0.0.24-test.AppImage";

interface FakeNet {
  readonly fetchImpl: typeof fetch;
  readonly seen: string[];
}

function fakeNetwork(feedBody: unknown, bundle: Buffer = BUNDLE_BYTES): FakeNet {
  const seen: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    seen.push(url);

    if (url === FEED_URL) {
      return new Response(typeof feedBody === "string" ? feedBody : JSON.stringify(feedBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === BUNDLE_URL) {
      return new Response(bundle, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  return { fetchImpl, seen };
}

function feedWith(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: "0.0.24-test",
    url: BUNDLE_URL,
    sha256: BUNDLE_SHA256,
    notes: "A newer test build.",
    ...overrides,
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "roan-update-flow-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("checkAndPrepareUpdate", () => {
  it("reads the feed, sees a newer version and returns a verified bundle path", async () => {
    const net = fakeNetwork(feedWith());

    await withTempDir(async (dir) => {
      const decision = await checkAndPrepareUpdate(FEED_URL, "0.0.23", {
        dir,
        fetchImpl: net.fetchImpl,
        timeoutMs: 1_000,
      });

      assert.equal(decision.state, "ready");
      if (decision.state !== "ready") return;
      assert.equal(decision.entry.version, "0.0.24-test");
      assert.equal(decision.bundle.sha256, BUNDLE_SHA256);
      assert.equal(await readFile(decision.bundle.path, "utf8"), BUNDLE_TEXT);
      assert.deepEqual(net.seen, [FEED_URL, BUNDLE_URL]);
    });
  });

  it("stops at the feed when it names the running version", async () => {
    const net = fakeNetwork(feedWith({ version: "0.0.24-test" }));

    await withTempDir(async (dir) => {
      const decision = await checkAndPrepareUpdate(FEED_URL, "0.0.24-test", {
        dir,
        fetchImpl: net.fetchImpl,
      });

      assert.equal(decision.state, "current");
      assert.deepEqual(net.seen, [FEED_URL], "no bundle request for a current version");
      assert.deepEqual(await readdir(dir), []);
    });
  });

  it("stops at the feed when it is older than the running version", async () => {
    const net = fakeNetwork(feedWith({ version: "0.0.22" }));

    await withTempDir(async (dir) => {
      const decision = await checkAndPrepareUpdate(FEED_URL, "0.0.23", {
        dir,
        fetchImpl: net.fetchImpl,
      });

      assert.equal(decision.state, "older");
      assert.deepEqual(net.seen, [FEED_URL]);
    });
  });

  it("propagates an unreachable feed instead of claiming there is no update", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    };

    await withTempDir(async (dir) => {
      await assert.rejects(
        () => checkAndPrepareUpdate(FEED_URL, "0.0.23", { dir, fetchImpl }),
        (error: unknown) => {
          assert.ok(error instanceof UpdateFeedError);
          assert.equal(error.kind, "unreachable");
          assert.match(error.message, /could not reach the update feed/);
          return true;
        },
      );
    });
  });

  it("propagates an invalid feed document", async () => {
    const net = fakeNetwork(feedWith({ sha256: "not-a-digest" }));

    await withTempDir(async (dir) => {
      await assert.rejects(
        () => checkAndPrepareUpdate(FEED_URL, "0.0.23", { dir, fetchImpl: net.fetchImpl }),
        (error: unknown) => {
          assert.ok(error instanceof UpdateFeedError);
          assert.equal(error.kind, "invalid");
          assert.match(error.message, /sha256/);
          return true;
        },
      );
      assert.deepEqual(net.seen, [FEED_URL], "an invalid feed never starts a download");
    });
  });
});
