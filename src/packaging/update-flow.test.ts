import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkAndPrepareUpdate, checkGithubAndPrepareUpdate } from "./update-flow.js";
import { GITHUB_API_BASE } from "./github-releases.js";
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

// ---------------------------------------------------------------------------
// The GitHub path: one call from "check" to "here is the installer".
// ---------------------------------------------------------------------------

const API_URL = `${GITHUB_API_BASE}/repos/roanh47/Roan/releases/latest`;
const APPIMAGE_NAME = "Roan-0.1.1-x86_64.AppImage";
const APPIMAGE_URL = `https://github.com/roanh47/Roan/releases/download/v0.1.1/${APPIMAGE_NAME}`;
const APK_NAME = "Roan-0.1.1.apk";
const APK_URL = `https://github.com/roanh47/Roan/releases/download/v0.1.1/${APK_NAME}`;

const RELEASE_BASE = "https://github.com/roanh47/Roan/releases/download/v0.1.1";

/** The release document, with the assets this flow is expected to pick. */
function githubRelease(): unknown {
  return {
    tag_name: "v0.1.1",
    body: "  Fixed the update card.  ",
    draft: false,
    prerelease: false,
    assets: [
      { name: "Roan-0.1.1-x64.exe", browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-x64.exe`, size: 19, digest: null },
      { name: "Roan-0.1.1-arm64.dmg", browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-arm64.dmg`, size: 19, digest: null },
      { name: APPIMAGE_NAME, browser_download_url: APPIMAGE_URL, size: BUNDLE_BYTES.byteLength, digest: `sha256:${BUNDLE_SHA256}` },
      { name: APK_NAME, browser_download_url: APK_URL, size: BUNDLE_BYTES.byteLength, digest: null },
    ],
  };
}

/** Serves the release document and the two artefacts this suite downloads. */
function githubNet(
  document: unknown = githubRelease(),
  assetBody: Buffer = BUNDLE_BYTES,
): { fetchImpl: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);

    if (url === API_URL) {
      return new Response(JSON.stringify(document), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === APPIMAGE_URL || url === APK_URL) {
      return new Response(assetBody, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, seen };
}

describe("checkGithubAndPrepareUpdate", () => {
  it("checks, then downloads and verifies the AppImage for a writable running file", async () => {
    const net = githubNet();

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.0",
        platform: "linux",
        arch: "x64",
        dir,
        fetchImpl: net.fetchImpl,
        executablePath: join(dir, "Running.AppImage"),
        executableWritable: true,
      });

      assert.equal(result.check.kind, "update");
      assert.equal(result.plan.action, "download");
      assert.equal(result.plan.url, APPIMAGE_URL);
      assert.match(result.plan.notes.join("\n"), /written over /);

      assert.ok(result.download !== null && result.download.ok);
      if (result.download === null || !result.download.ok) return;
      assert.equal(result.download.path, join(dir, APPIMAGE_NAME));
      assert.equal(result.download.sha256, BUNDLE_SHA256);
      assert.equal(await readFile(result.download.path, "utf8"), BUNDLE_TEXT);
      assert.deepEqual(net.seen, [API_URL, APPIMAGE_URL]);
    });
  });

  it("downloads the APK but plans a manual install, because Android cannot self-replace", async () => {
    const net = githubNet();

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.0",
        platform: "android",
        arch: "arm64",
        dir,
        fetchImpl: net.fetchImpl,
      });

      assert.equal(result.plan.action, "manual");
      assert.match(result.plan.notes.join("\n"), /system package installer/);
      assert.ok(result.download !== null && result.download.ok, "the APK is still fetched");
      if (result.download === null || !result.download.ok) return;
      assert.equal(result.download.path, join(dir, APK_NAME));
    });
  });

  it("fetches nothing when the running version is the latest", async () => {
    const net = githubNet();

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.1",
        platform: "linux",
        arch: "x64",
        dir,
        fetchImpl: net.fetchImpl,
      });

      assert.equal(result.check.kind, "current");
      assert.equal(result.plan.action, "none");
      assert.equal(result.download, null);
      assert.deepEqual(net.seen, [API_URL]);
      assert.deepEqual(await readdir(dir), []);
    });
  });

  it("resolves without throwing when GitHub cannot be reached", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.0",
        platform: "linux",
        arch: "x64",
        dir,
        fetchImpl,
      });

      assert.equal(result.check.kind, "unreachable");
      assert.equal(result.plan.action, "none");
      assert.equal(result.download, null);
    });
  });

  it("decides without downloading when the caller asks for a check only", async () => {
    const net = githubNet();

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.0",
        platform: "linux",
        arch: "x64",
        dir,
        fetchImpl: net.fetchImpl,
        download: false,
      });

      assert.equal(result.plan.action, "download");
      assert.equal(result.download, null);
      assert.deepEqual(net.seen, [API_URL]);
      assert.deepEqual(await readdir(dir), []);
    });
  });

  it("keeps the plan but adds the reason when the download fails its digest", async () => {
    const net = githubNet(githubRelease(), Buffer.from("tampered\n"));

    await withTempDir(async (dir) => {
      const result = await checkGithubAndPrepareUpdate({
        currentVersion: "0.1.0",
        platform: "linux",
        arch: "x64",
        dir,
        fetchImpl: net.fetchImpl,
      });

      assert.equal(result.plan.action, "download");
      assert.match(result.plan.notes.join("\n"), /Download failed: .*sha256 mismatch/);
      assert.ok(result.download !== null && !result.download.ok);
      assert.deepEqual(await readdir(dir), [], "a tampered download leaves nothing behind");
    });
  });
});
