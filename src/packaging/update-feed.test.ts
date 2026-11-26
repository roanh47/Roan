import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

import {
  compareFeedToVersion,
  fetchUpdateFeed,
  MAX_FEED_CHARS,
  parseUpdateFeedText,
  UpdateFeedError,
} from "./update-feed.js";

/**
 * The feed is the only thing that tells the app a newer build exists, so these
 * tests pin both halves: a valid `latest.json` becomes one typed entry, and a
 * feed that never answered is reported as unreachable instead of being folded
 * into "you are current". Everything runs against a local 127.0.0.1 fixture;
 * no external host is touched.
 */

const SHA256 = "9f2c4b1d8e7a6f5c4b3a2d1e0f9c8b7a6d5e4f3c2b1a0f9e8d7c6b5a4f3e2d10";

const FEED = {
  version: "0.0.24-test",
  url: "https://downloads.example.invalid/Roan-0.0.24-test.AppImage",
  sha256: SHA256,
  notes: "Local feed for the updater round.",
  mandatory: false,
};

interface Fixture {
  readonly baseUrl: string;
  readonly server: Server;
  close(): Promise<void>;
}

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Fixture> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server did not expose a port");
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  return {
    baseUrl,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Assert the thrown value is an UpdateFeedError of the expected kind. */
async function assertFeedError(
  action: () => Promise<unknown>,
  kind: "unreachable" | "invalid",
): Promise<UpdateFeedError> {
  try {
    await action();
  } catch (error) {
    assert.ok(
      error instanceof UpdateFeedError,
      `expected an UpdateFeedError, got ${String(error)}`,
    );
    assert.equal(error.kind, kind, `expected kind ${kind}, got ${error.kind}: ${error.message}`);
    return error;
  }
  assert.fail(`expected an UpdateFeedError of kind ${kind}, nothing was thrown`);
}

describe("parseUpdateFeedText", () => {
  it("reads a flat latest.json into one complete entry", () => {
    const entry = parseUpdateFeedText(JSON.stringify(FEED));

    assert.deepEqual(entry, {
      version: "0.0.24-test",
      url: FEED.url,
      sha256: SHA256,
      notes: FEED.notes,
      mandatory: false,
    });
  });

  it("applies the entry defaults when notes and mandatory are absent", () => {
    const entry = parseUpdateFeedText(
      JSON.stringify({ version: "0.0.24", url: FEED.url, sha256: SHA256 }),
    );

    assert.equal(entry.notes, "");
    assert.equal(entry.mandatory, false);
  });

  it("reports broken JSON as an invalid feed, not an update", () => {
    assert.throws(
      () => parseUpdateFeedText('{"version":'),
      (error: unknown) => {
        assert.ok(error instanceof UpdateFeedError);
        assert.equal(error.kind, "invalid");
        assert.match(error.message, /not valid JSON/);
        return true;
      },
    );
  });

  it("names the missing or unknown field in an invalid document", () => {
    assert.throws(
      () => parseUpdateFeedText(JSON.stringify({ version: "0.0.24", url: FEED.url })),
      (error: unknown) => {
        assert.ok(error instanceof UpdateFeedError);
        assert.equal(error.kind, "invalid");
        assert.match(error.message, /sha256/);
        return true;
      },
    );

    assert.throws(
      () => parseUpdateFeedText(JSON.stringify({ ...FEED, channel: "beta" })),
      (error: unknown) => {
        assert.ok(error instanceof UpdateFeedError);
        assert.equal(error.kind, "invalid");
        assert.match(error.message, /channel/);
        return true;
      },
    );
  });

  it("rejects a non-object document", () => {
    for (const bad of ["null", "[]", '"0.0.24"', "42"]) {
      assert.throws(
        () => parseUpdateFeedText(bad),
        (error: unknown) => {
          assert.ok(error instanceof UpdateFeedError);
          assert.equal(error.kind, "invalid");
          return true;
        },
      );
    }
  });
});

describe("fetchUpdateFeed", () => {
  it("reads and validates the feed over local http", async () => {
    let requestedPath = "";
    const fixture = await startServer((request, response) => {
      requestedPath = request.url ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(FEED));
    });

    try {
      const entry = await fetchUpdateFeed(`${fixture.baseUrl}/latest.json`);
      assert.equal(requestedPath, "/latest.json");
      assert.equal(entry.version, "0.0.24-test");
      assert.equal(entry.sha256, SHA256);
    } finally {
      await fixture.close();
    }
  });

  it("calls a non-2xx answer unreachable", async () => {
    const fixture = await startServer((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("later");
    });

    try {
      const error = await assertFeedError(
        () => fetchUpdateFeed(`${fixture.baseUrl}/latest.json`),
        "unreachable",
      );
      assert.match(error.message, /HTTP 503/);
    } finally {
      await fixture.close();
    }
  });

  it("calls a refused connection unreachable", async () => {
    const fixture = await startServer((_request, response) => {
      response.end("{}");
    });
    const url = `${fixture.baseUrl}/latest.json`;
    await fixture.close();

    const error = await assertFeedError(() => fetchUpdateFeed(url), "unreachable");
    assert.match(error.message, /could not reach the update feed/);
  });

  it("calls a silent server unreachable when the timeout fires", async () => {
    const fixture = await startServer(() => {
      // Intentionally never answer.
    });

    try {
      const error = await assertFeedError(
        () => fetchUpdateFeed(`${fixture.baseUrl}/latest.json`, { timeoutMs: 100 }),
        "unreachable",
      );
      assert.match(error.message, /could not reach the update feed/);
    } finally {
      await fixture.close();
    }
  });

  it("calls an answered but invalid document invalid", async () => {
    const fixture = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"version":"0.0.24","notes":"missing url and sha256"}');
    });

    try {
      const error = await assertFeedError(
        () => fetchUpdateFeed(`${fixture.baseUrl}/latest.json`),
        "invalid",
      );
      assert.match(error.message, /update feed is invalid/);
    } finally {
      await fixture.close();
    }
  });

  it("refuses a feed larger than the cap", async () => {
    const fixture = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(`{"notes":"${"a".repeat(MAX_FEED_CHARS)}"}`);
    });

    try {
      await assertFeedError(() => fetchUpdateFeed(`${fixture.baseUrl}/latest.json`), "invalid");
    } finally {
      await fixture.close();
    }
  });

  it("refuses a feed URL that is not http(s)", async () => {
    await assertFeedError(() => fetchUpdateFeed("file:///etc/passwd"), "invalid");
    await assertFeedError(() => fetchUpdateFeed(""), "invalid");
  });
});

describe("compareFeedToVersion", () => {
  const entry = parseUpdateFeedText(JSON.stringify(FEED));

  it("says newer, equal and older against the running version", () => {
    assert.equal(compareFeedToVersion(entry, "0.0.23"), 1);
    assert.equal(compareFeedToVersion(entry, "0.0.24-test"), 0);
    assert.equal(compareFeedToVersion(entry, "0.0.25"), -1);
  });
});
