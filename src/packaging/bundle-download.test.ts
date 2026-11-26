import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { describe, it } from "node:test";

import { downloadBundle, prepareUpdate } from "./bundle-download.js";
import type { FeedEntry } from "./updater.js";

/**
 * A bundle is only usable once its bytes match the feed's digest. These tests
 * serve real bytes from a local 127.0.0.1 fixture: success writes the exact
 * file, a wrong digest deletes it, and an HTTP failure leaves nothing behind
 * that a later run could mistake for a verified download.
 */

const BUNDLE_TEXT = "Roan bundle for the updater round\nline two\n";
const BUNDLE_BYTES = Buffer.from(BUNDLE_TEXT, "utf8");
const BUNDLE_SHA256 = createHash("sha256").update(BUNDLE_BYTES).digest("hex");
const WRONG_SHA256 = createHash("sha256").update("something else").digest("hex");

interface Fixture {
  readonly baseUrl: string;
  readonly requests: { count: number };
  close(): Promise<void>;
}

async function startBundleServer(path: string, body: Buffer, status = 200): Promise<Fixture> {
  const requests = { count: 0 };
  const server = createServer((request, response) => {
    requests.count += 1;
    if (request.url !== path) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(status, {
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
    });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server did not expose a port");

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "roan-update-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function feedFor(url: string, sha256: string, version = "0.0.24-test"): FeedEntry {
  return { version, url, sha256, notes: "test bundle", mandatory: false };
}

describe("downloadBundle", () => {
  it("writes the exact bytes and returns the verified digest", async () => {
    const fixture = await startBundleServer("/Roan-0.0.24-test.AppImage", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        const result = await downloadBundle(
          `${fixture.baseUrl}/Roan-0.0.24-test.AppImage`,
          BUNDLE_SHA256,
          { dir },
        );

        assert.equal(result.path, join(dir, "Roan-0.0.24-test.AppImage"));
        assert.equal(result.bytes, BUNDLE_BYTES.byteLength);
        assert.equal(result.sha256, BUNDLE_SHA256);
        assert.equal(await readFile(result.path, "utf8"), BUNDLE_TEXT);
        assert.equal(fixture.requests.count, 1);
      });
    } finally {
      await fixture.close();
    }
  });

  it("deletes the file when the digest does not match", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        await assert.rejects(
          () => downloadBundle(`${fixture.baseUrl}/bundle.bin`, WRONG_SHA256, { dir }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /sha256 mismatch/);
            assert.ok(error.message.includes(WRONG_SHA256), "message names the expected digest");
            assert.ok(error.message.includes(BUNDLE_SHA256), "message names the actual digest");
            return true;
          },
        );

        assert.deepEqual(await readdir(dir), [], "an unverified bundle must not remain");
      });
    } finally {
      await fixture.close();
    }
  });

  it("leaves nothing behind when the server answers HTTP 404", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        await assert.rejects(
          () => downloadBundle(`${fixture.baseUrl}/missing.bin`, BUNDLE_SHA256, { dir }),
          /HTTP 404/,
        );
        assert.deepEqual(await readdir(dir), []);
      });
    } finally {
      await fixture.close();
    }
  });

  it("refuses a bad expected digest before any request", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        await assert.rejects(
          () => downloadBundle(`${fixture.baseUrl}/bundle.bin`, "ABC", { dir }),
          /64 lower-case hex/,
        );
        assert.equal(fixture.requests.count, 0);
      });
    } finally {
      await fixture.close();
    }
  });

  it("keeps a crafted file name inside the target directory", async () => {
    const fixture = await startBundleServer("/..%2Fevil.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        const result = await downloadBundle(`${fixture.baseUrl}/..%2Fevil.bin`, BUNDLE_SHA256, { dir });

        assert.equal(basename(result.path), "evil.bin");
        assert.ok(result.path.startsWith(`${dir}${sep}`), "path must stay below the temp dir");
      });
    } finally {
      await fixture.close();
    }
  });
});

describe("prepareUpdate", () => {
  it("does not download when the feed names the running version", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        const decision = await prepareUpdate(
          feedFor(`${fixture.baseUrl}/bundle.bin`, BUNDLE_SHA256, "0.0.24-test"),
          "0.0.24-test",
          { dir },
        );

        assert.equal(decision.state, "current");
        assert.equal(fixture.requests.count, 0);
        assert.deepEqual(await readdir(dir), []);
      });
    } finally {
      await fixture.close();
    }
  });

  it("does not download when the feed is older than the running version", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        const decision = await prepareUpdate(
          feedFor(`${fixture.baseUrl}/bundle.bin`, BUNDLE_SHA256, "0.0.22"),
          "0.0.23",
          { dir },
        );

        assert.equal(decision.state, "older");
        assert.equal(fixture.requests.count, 0);
        assert.deepEqual(await readdir(dir), []);
      });
    } finally {
      await fixture.close();
    }
  });

  it("downloads, verifies and hands back the path for a newer prerelease", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        const decision = await prepareUpdate(
          feedFor(`${fixture.baseUrl}/bundle.bin`, BUNDLE_SHA256, "0.0.24-test"),
          "0.0.23",
          { dir },
        );

        assert.equal(decision.state, "ready");
        if (decision.state !== "ready") return;
        assert.equal(decision.bundle.sha256, BUNDLE_SHA256);
        assert.equal(decision.bundle.bytes, BUNDLE_BYTES.byteLength);
        assert.equal(await readFile(decision.bundle.path, "utf8"), BUNDLE_TEXT);
        assert.equal(fixture.requests.count, 1);
      });
    } finally {
      await fixture.close();
    }
  });

  it("a digest mismatch fails the whole decision instead of handing over a file", async () => {
    const fixture = await startBundleServer("/bundle.bin", BUNDLE_BYTES);

    try {
      await withTempDir(async (dir) => {
        await assert.rejects(
          () =>
            prepareUpdate(
              feedFor(`${fixture.baseUrl}/bundle.bin`, WRONG_SHA256, "0.0.24-test"),
              "0.0.23",
              { dir },
            ),
          /sha256 mismatch/,
        );
        assert.deepEqual(await readdir(dir), []);
      });
    } finally {
      await fixture.close();
    }
  });
});
