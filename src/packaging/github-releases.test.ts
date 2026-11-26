import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  GITHUB_API_BASE,
  assetFileName,
  checkGithubRelease,
  downloadAndVerify,
  pickAsset,
  planGithubUpdate,
  stripTagPrefix,
  type GithubReleaseAsset,
} from "./github-releases.js";

/**
 * Every test here answers one question: what does a shipped build do when the
 * network, the release document, or the asset list is not what it hopes for?
 *
 * `fetch` is always injected. No test opens a socket, and the release documents
 * are the same shapes the GitHub API returns, reduced to the fields the updater
 * reads. The download tests write into a temp directory and remove it.
 */

const API_URL = `${GITHUB_API_BASE}/repos/roanh47/Roan/releases/latest`;
const RELEASE_BASE = "https://github.com/roanh47/Roan/releases/download/v0.1.1";

const EXE_BODY = Buffer.from("nsis installer bytes\n", "utf8");
const EXE_SHA = createHash("sha256").update(EXE_BODY).digest("hex");

/** The four assets a release publishes, named exactly as CI names them. */
function releaseAssets(): unknown[] {
  return [
    {
      name: "Roan-0.1.1-x64.msi",
      browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
      size: EXE_BODY.byteLength,
      digest: `sha256:${EXE_SHA}`,
    },
    {
      name: "Roan-0.1.1-arm64.dmg",
      browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-arm64.dmg`,
      size: 2_000,
      digest: null,
    },
    {
      name: "Roan-0.1.1-x86_64.AppImage",
      browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-x86_64.AppImage`,
      size: 3_000,
      digest: null,
    },
    {
      name: "Roan-0.1.1.apk",
      browser_download_url: `${RELEASE_BASE}/Roan-0.1.1.apk`,
      size: 4_000,
      digest: null,
    },
  ];
}

function releaseDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: "v0.1.1",
    name: "Roan 0.1.1",
    body: "  Fixed the update card.  ",
    draft: false,
    prerelease: false,
    assets: releaseAssets(),
    ...overrides,
  };
}

interface FakeNet {
  readonly fetchImpl: typeof fetch;
  readonly seen: string[];
  readonly headers: Headers[];
}

/** A fetch that serves one canned answer for the API URL. */
function fakeNet(body: unknown, init: ResponseInit = { status: 200 }): FakeNet {
  const seen: string[] = [];
  const headers: Headers[] = [];

  const fetchImpl: typeof fetch = async (input, options) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    headers.push(new Headers(options?.headers));
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  };

  return { fetchImpl, seen, headers };
}

interface Target {
  readonly platform: string;
  readonly arch: string;
}

const LINUX: Target = { platform: "linux", arch: "x64" };

function check(
  net: FakeNet,
  target: Target = LINUX,
  currentVersion = "0.1.0",
): ReturnType<typeof checkGithubRelease> {
  return checkGithubRelease({
    currentVersion,
    platform: target.platform,
    arch: target.arch,
    fetchImpl: net.fetchImpl,
    timeoutMs: 1_000,
  });
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "roan-github-releases-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// checkGithubRelease
// ---------------------------------------------------------------------------

describe("checkGithubRelease", () => {
  it("asks the public repository's latest-release endpoint with a JSON accept header", async () => {
    const net = fakeNet(releaseDocument());
    await check(net);

    assert.deepEqual(net.seen, [API_URL]);
    assert.equal(net.headers[0]?.get("accept"), "application/vnd.github+json");
  });

  it("offers a newer release with the notes and the one matching asset", async () => {
    const net = fakeNet(releaseDocument());
    const result = await check(net);

    assert.equal(result.kind, "update");
    if (result.kind !== "update") return;
    assert.equal(result.current, "0.1.0");
    assert.equal(result.latest, "0.1.1");
    assert.equal(result.notes, "Fixed the update card.");
    assert.equal(result.asset.name, "Roan-0.1.1-x86_64.AppImage");
    assert.equal(result.asset.url, `${RELEASE_BASE}/Roan-0.1.1-x86_64.AppImage`);
    assert.equal(result.asset.size, 3_000);
  });

  it("reports the running version when the release names it (tag prefix ignored)", async () => {
    const net = fakeNet(releaseDocument());
    const result = await check(net, LINUX, "0.1.1");

    assert.deepEqual(result, { kind: "current", version: "0.1.1" });
  });

  it("reports the running version when the release is older", async () => {
    const net = fakeNet(releaseDocument({ tag_name: "v0.1.0" }));
    const result = await check(net, LINUX, "0.1.1");

    assert.deepEqual(result, { kind: "current", version: "0.1.1" });
  });

  it("lifts the sha256 digest, in lower case, off the matching asset", async () => {
    const net = fakeNet(
      releaseDocument({
        assets: [
          {
            name: "Roan-0.1.1-x64.msi",
            browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
            size: 19,
            digest: `SHA256:${EXE_SHA.toUpperCase()}`,
          },
        ],
      }),
    );
    const result = await check(net, { platform: "win32", arch: "x64" });

    assert.equal(result.kind, "update");
    if (result.kind !== "update") return;
    assert.equal(result.asset.sha256, EXE_SHA);
  });

  it("refuses a digest in an algorithm it cannot verify", async () => {
    const net = fakeNet(
      releaseDocument({
        assets: [
          {
            name: "Roan-0.1.1-x64.msi",
            browser_download_url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
            size: 19,
            digest: "sha512:abcdef",
          },
        ],
      }),
    );
    const result = await check(net, { platform: "win32", arch: "x64" });

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /not a sha256 digest/);
  });

  it("returns unreachable, with the cause, when fetch rejects", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    };
    const result = await checkGithubRelease({
      currentVersion: "0.1.0",
      platform: "linux",
      arch: "x64",
      fetchImpl,
    });

    assert.equal(result.kind, "unreachable");
    if (result.kind !== "unreachable") return;
    assert.match(result.reason, /could not reach/);
    assert.match(result.reason, /ENOTFOUND/);
  });

  it("returns unreachable for HTTP 404 and says why that can happen", async () => {
    const net = fakeNet("{\"message\":\"Not Found\"}", { status: 404 });
    const result = await check(net);

    assert.equal(result.kind, "unreachable");
    if (result.kind !== "unreachable") return;
    assert.match(result.reason, /HTTP 404/);
    assert.match(result.reason, /no published release/);
  });

  it("returns unreachable for a rate-limited 403", async () => {
    const net = fakeNet("{\"message\":\"API rate limit exceeded\"}", { status: 403 });
    const result = await check(net);

    assert.equal(result.kind, "unreachable");
    if (result.kind !== "unreachable") return;
    assert.match(result.reason, /rate limited/);
  });

  it("returns invalid for a body that is not JSON", async () => {
    const net = fakeNet("<html>gateway</html>");
    const result = await check(net);

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /not valid JSON/);
  });

  it("returns invalid for a JSON body that is not a release object", async () => {
    const net = fakeNet([1, 2, 3]);
    const result = await check(net);

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /must be an object/);
  });

  it("does not offer a draft release", async () => {
    const net = fakeNet(releaseDocument({ draft: true }));
    const result = await check(net);

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /draft/);
  });

  it("does not offer a prerelease", async () => {
    const net = fakeNet(releaseDocument({ tag_name: "v0.2.0-rc.1", prerelease: true }));
    const result = await check(net, LINUX, "0.1.1");

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /prerelease/);
  });

  it("returns invalid for an unparseable tag, naming both versions", async () => {
    const net = fakeNet(releaseDocument({ tag_name: "nightly" }));
    const result = await check(net);

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /nightly/);
    assert.match(result.reason, /0\.1\.0/);
  });

  it("returns invalid when the release has no asset for this platform", async () => {
    const net = fakeNet(releaseDocument());
    const result = await check(net, { platform: "darwin", arch: "x64" });

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /no asset for darwin\/x64/);
    assert.match(result.reason, /Roan-0\.1\.1-arm64\.dmg/);
  });

  it("returns invalid when the release publishes no downloads at all", async () => {
    const net = fakeNet(releaseDocument({ assets: [] }));
    const result = await check(net);

    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") return;
    assert.match(result.reason, /publishes no downloads/);
  });

  it("returns invalid for a bad repository name instead of asking GitHub", async () => {
    const net = fakeNet(releaseDocument());
    const result = await checkGithubRelease({
      owner: "../evil",
      repo: "Roan",
      currentVersion: "0.1.0",
      platform: "linux",
      arch: "x64",
      fetchImpl: net.fetchImpl,
    });

    assert.equal(result.kind, "invalid");
    assert.deepEqual(net.seen, []);
  });
});

// ---------------------------------------------------------------------------
// pickAsset
// ---------------------------------------------------------------------------

const ASSET = (name: string): GithubReleaseAsset => ({
  name,
  url: `${RELEASE_BASE}/${name}`,
  size: 1,
});

describe("pickAsset", () => {
  it("picks the AppImage on linux/x64 and nothing else", () => {
    const assets = [
      ASSET("Roan-0.1.1-x64.msi"),
      ASSET("Roan-0.1.1-arm64.dmg"),
      ASSET("Roan-0.1.1-x86_64.AppImage"),
      ASSET("Roan-0.1.1.apk"),
    ];
    assert.equal(pickAsset(assets, "linux", "x64")?.name, "Roan-0.1.1-x86_64.AppImage");
  });

  it("picks the arm64 AppImage on linux/arm64 when one exists", () => {
    const assets = [
      ASSET("Roan-0.1.1-x86_64.AppImage"),
      ASSET("Roan-0.1.1-aarch64.AppImage"),
    ];
    assert.equal(pickAsset(assets, "linux", "arm64")?.name, "Roan-0.1.1-aarch64.AppImage");
  });

  it("returns null on linux/arm64 rather than handing over an x86_64 build", () => {
    assert.equal(pickAsset([ASSET("Roan-0.1.1-x86_64.AppImage")], "linux", "arm64"), null);
  });

  it("picks the .msi on win32 and refuses an arm64 package for x64", () => {
    assert.equal(pickAsset([ASSET("Roan-0.1.1-x64.msi")], "win32", "x64")?.name, "Roan-0.1.1-x64.msi");
    assert.equal(pickAsset([ASSET("Roan-0.1.1-arm64.msi")], "win32", "x64"), null);
  });

  it("picks the matching .dmg per macOS architecture", () => {
    const assets = [ASSET("Roan-0.1.1-arm64.dmg"), ASSET("Roan-0.1.1-x64.dmg")];
    assert.equal(pickAsset(assets, "darwin", "arm64")?.name, "Roan-0.1.1-arm64.dmg");
    assert.equal(pickAsset(assets, "darwin", "x64")?.name, "Roan-0.1.1-x64.dmg");
  });

  it("accepts a universal .dmg for either macOS architecture", () => {
    const universal = [ASSET("Roan-0.1.1-universal.dmg")];
    assert.equal(pickAsset(universal, "darwin", "arm64")?.name, "Roan-0.1.1-universal.dmg");
    assert.equal(pickAsset(universal, "darwin", "x64")?.name, "Roan-0.1.1-universal.dmg");
  });

  it("prefers the ABI-specific APK over the universal one", () => {
    const assets = [
      ASSET("Roan-0.1.1.apk"),
      ASSET("Roan-0.1.1-arm64-v8a.apk"),
      ASSET("Roan-0.1.1-x86_64.apk"),
    ];
    assert.equal(pickAsset(assets, "android", "arm64")?.name, "Roan-0.1.1-arm64-v8a.apk");
    assert.equal(pickAsset(assets, "android", "x64")?.name, "Roan-0.1.1-x86_64.apk");
  });

  it("falls back to the universal APK when no split matches", () => {
    const assets = [ASSET("Roan-0.1.1.apk"), ASSET("Roan-0.1.1-x86_64.apk")];
    assert.equal(pickAsset(assets, "android", "arm64")?.name, "Roan-0.1.1.apk");
  });

  it("does not read x86_64 as the 32-bit x86 ABI", () => {
    assert.equal(pickAsset([ASSET("Roan-0.1.1-x86_64.apk")], "android", "ia32"), null);
  });

  it("returns null for an unknown platform, an unknown architecture or no assets", () => {
    const assets = [ASSET("Roan-0.1.1-x86_64.AppImage")];
    assert.equal(pickAsset(assets, "freebsd", "x64"), null);
    assert.equal(pickAsset(assets, "linux", "riscv64"), null);
    assert.equal(pickAsset([], "linux", "x64"), null);
  });
});

// ---------------------------------------------------------------------------
// planGithubUpdate
// ---------------------------------------------------------------------------

const UPDATE_RESULT = {
  kind: "update" as const,
  current: "0.1.0",
  latest: "0.1.1",
  notes: "Fixed the update card.",
  asset: {
    name: "Roan-0.1.1-x86_64.AppImage",
    url: `${RELEASE_BASE}/Roan-0.1.1-x86_64.AppImage`,
    size: 3_000,
  },
};

describe("planGithubUpdate", () => {
  it("does nothing when the running version is the latest", () => {
    const plan = planGithubUpdate({ kind: "current", version: "0.1.1" }, LINUX);
    assert.equal(plan.action, "none");
    assert.equal(plan.url, null);
    assert.match(plan.notes.join(" "), /0\.1\.1 is the latest published release/);
  });

  it("does not claim to be up to date when GitHub could not be reached", () => {
    const plan = planGithubUpdate({ kind: "unreachable", reason: "HTTP 404" }, LINUX);
    assert.equal(plan.action, "none");
    assert.match(plan.notes.join(" "), /not known to be up to date/);
    assert.match(plan.notes.join(" "), /HTTP 404/);
  });

  it("downloads the AppImage and names the in-place swap when the file is writable", () => {
    const plan = planGithubUpdate(UPDATE_RESULT, {
      ...LINUX,
      executablePath: "/home/roan/Applications/Roan.AppImage",
      executableWritable: true,
    });

    assert.equal(plan.action, "download");
    assert.equal(plan.url, UPDATE_RESULT.asset.url);
    assert.match(plan.notes.join("\n"), /written over \/home\/roan\/Applications\/Roan\.AppImage/);
  });

  it("downloads the AppImage but does not promise a swap when the file is not writable", () => {
    const plan = planGithubUpdate(UPDATE_RESULT, {
      ...LINUX,
      executablePath: "/opt/Roan.AppImage",
      executableWritable: false,
    });

    assert.equal(plan.action, "download");
    const notes = plan.notes.join("\n");
    assert.match(notes, /is not writable/);
    assert.doesNotMatch(notes, /written over/);
  });

  it("says a matching digest is not a signature when the release publishes one", () => {
    const withDigest = { ...UPDATE_RESULT, asset: { ...UPDATE_RESULT.asset, sha256: EXE_SHA } };
    const plan = planGithubUpdate(withDigest, LINUX);
    assert.match(plan.notes.join("\n"), /checked against the SHA-256/);
    assert.match(plan.notes.join("\n"), /no GPG signature/);
  });

  it("says plainly when the release publishes no digest", () => {
    const plan = planGithubUpdate(UPDATE_RESULT, LINUX);
    assert.match(plan.notes.join("\n"), /publishes no SHA-256/);
  });

  it("marks Android as manual: the download needs the system installer", () => {
    const apk = {
      ...UPDATE_RESULT,
      asset: { name: "Roan-0.1.1.apk", url: `${RELEASE_BASE}/Roan-0.1.1.apk`, size: 4_000 },
    };
    const plan = planGithubUpdate(apk, { platform: "android", arch: "arm64" });

    assert.equal(plan.action, "manual");
    assert.equal(plan.url, `${RELEASE_BASE}/Roan-0.1.1.apk`);
    const notes = plan.notes.join("\n");
    assert.match(notes, /cannot replace the app that is running/);
    assert.match(notes, /system package installer/);
    assert.match(notes, /install unknown apps/);
    assert.doesNotMatch(notes, /replaces the installed version/);
  });

  it("downloads the Windows MSI and names the signing caveat", () => {
    const exe = {
      ...UPDATE_RESULT,
      asset: { name: "Roan-0.1.1-x64.msi", url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`, size: 19 },
    };
    const plan = planGithubUpdate(exe, { platform: "win32", arch: "x64" });

    assert.equal(plan.action, "download");
    const notes = plan.notes.join("\n");
    assert.match(notes, /Windows Installer package/);
    assert.match(notes, /msiexec/);
    assert.match(notes, /not Authenticode-signed/);
  });

  it("downloads the macOS image and names Gatekeeper", () => {
    const dmg = {
      ...UPDATE_RESULT,
      asset: { name: "Roan-0.1.1-arm64.dmg", url: `${RELEASE_BASE}/Roan-0.1.1-arm64.dmg`, size: 2_000 },
    };
    const plan = planGithubUpdate(dmg, { platform: "darwin", arch: "arm64" });

    assert.equal(plan.action, "download");
    const notes = plan.notes.join("\n");
    assert.match(notes, /drag the app into Applications/);
    assert.match(notes, /Gatekeeper/);
    assert.match(notes, /not Developer ID signed/);
  });
});

// ---------------------------------------------------------------------------
// downloadAndVerify
// ---------------------------------------------------------------------------

/** A fetch that serves one body for any URL. */
function bodyFetch(body: Buffer, status = 200): typeof fetch {
  return async () => new Response(body, { status });
}

describe("downloadAndVerify", () => {
  it("writes the file at dest only after the sha256 matches", async () => {
    await withTempDir(async (dir) => {
      const dest = join(dir, "Roan-0.1.1-x64.msi");
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(EXE_BODY),
        url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
        dest,
        sha256: EXE_SHA,
        maxBytes: 1_000,
      });

      assert.deepEqual(outcome, { ok: true, path: dest, bytes: EXE_BODY.byteLength, sha256: EXE_SHA });
      assert.equal(await readFile(dest, "utf8"), EXE_BODY.toString("utf8"));
      assert.deepEqual(await readdir(dir), ["Roan-0.1.1-x64.msi"]);
    });
  });

  it("keeps no file when the sha256 does not match", async () => {
    await withTempDir(async (dir) => {
      const dest = join(dir, "Roan-0.1.1-x64.msi");
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(EXE_BODY),
        url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
        dest,
        sha256: "0".repeat(64),
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.match(outcome.reason, /sha256 mismatch/);
      assert.deepEqual(await readdir(dir), [], "a failed digest must leave nothing behind");
    });
  });

  it("refuses a body larger than maxBytes and leaves nothing behind", async () => {
    await withTempDir(async (dir) => {
      const dest = join(dir, "big.AppImage");
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(Buffer.alloc(64, 1)),
        url: `${RELEASE_BASE}/Roan-0.1.1-x86_64.AppImage`,
        dest,
        maxBytes: 8,
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.match(outcome.reason, /larger than the 8-byte limit/);
      assert.deepEqual(await readdir(dir), []);
    });
  });

  it("reports an HTTP failure without creating the file", async () => {
    await withTempDir(async (dir) => {
      const dest = join(dir, "Roan-0.1.1.apk");
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(Buffer.from("gone"), 500),
        url: `${RELEASE_BASE}/Roan-0.1.1.apk`,
        dest,
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.match(outcome.reason, /HTTP 500/);
      assert.deepEqual(await readdir(dir), []);
    });
  });

  it("reports a rejected fetch as a value, never a throw", async () => {
    await withTempDir(async (dir) => {
      const outcome = await downloadAndVerify({
        fetch: async () => {
          throw new Error("socket hang up");
        },
        url: `${RELEASE_BASE}/Roan-0.1.1.apk`,
        dest: join(dir, "Roan-0.1.1.apk"),
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.match(outcome.reason, /socket hang up/);
    });
  });

  it("accepts a download the release publishes no digest for, and returns the hash", async () => {
    await withTempDir(async (dir) => {
      const dest = join(dir, "Roan-0.1.1-arm64.dmg");
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(EXE_BODY),
        url: `${RELEASE_BASE}/Roan-0.1.1-arm64.dmg`,
        dest,
      });

      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      assert.equal(outcome.sha256, EXE_SHA);
    });
  });

  it("refuses a malformed expected digest before fetching anything", async () => {
    await withTempDir(async (dir) => {
      let called = 0;
      const outcome = await downloadAndVerify({
        fetch: async () => {
          called += 1;
          return new Response(EXE_BODY);
        },
        url: `${RELEASE_BASE}/Roan-0.1.1-x64.msi`,
        dest: join(dir, "Roan-0.1.1-x64.msi"),
        sha256: "not-a-digest",
      });

      assert.equal(outcome.ok, false);
      assert.equal(called, 0);
    });
  });

  it("refuses a non-https url", async () => {
    await withTempDir(async (dir) => {
      const outcome = await downloadAndVerify({
        fetch: bodyFetch(EXE_BODY),
        url: "file:///etc/passwd",
        dest: join(dir, "passwd"),
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.match(outcome.reason, /must be http or https/);
    });
  });
});

describe("assetFileName", () => {
  it("reduces a published name to a plain file name", () => {
    assert.equal(assetFileName("Roan-0.1.1-x86_64.AppImage"), "Roan-0.1.1-x86_64.AppImage");
    assert.equal(assetFileName("../../etc/passwd"), "passwd");
    assert.equal(assetFileName("a b.apk"), "a_b.apk");
  });
});

describe("stripTagPrefix", () => {
  it("removes one leading v, in either case", () => {
    assert.equal(stripTagPrefix("v0.1.1"), "0.1.1");
    assert.equal(stripTagPrefix("V0.1.1"), "0.1.1");
    assert.equal(stripTagPrefix("0.1.1"), "0.1.1");
  });
});
