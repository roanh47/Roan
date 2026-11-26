import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  LANGUAGE_SERVERS,
  createCodeIntel,
  definitionAt,
  normalizeLocations,
  pathProbe,
  probeLanguageServer,
  referencesAt,
  toUri,
  type LanguageServerSpec,
  type LspClient,
  type LspPosition,
} from "./lsp.js";

/**
 * Everything here runs without a language server: the probe takes a fake
 * `probe`/`exists`, the queries take a fake client. That is the point of the
 * two seams — presence and transport are decided outside this module.
 */

const ROOT = "/home/roan/project";

/** An `exists` that says yes only for the given absolute paths. */
function existsOnly(...paths: string[]): (candidate: string) => boolean {
  const known = new Set(paths);
  return (candidate) => known.has(candidate);
}

/** A `probe` that knows exactly these commands. */
function probeOnly(...commands: string[]): (command: string) => boolean {
  const known = new Set(commands);
  return (command) => known.has(command);
}

interface Call {
  readonly uri: string;
  readonly position: LspPosition;
  readonly includeDeclaration?: boolean;
}

function recordingClient(result: unknown): { client: LspClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: LspClient = {
    definition(uri, position) {
      calls.push({ uri, position });
      return Promise.resolve(result);
    },
    references(uri, position, options) {
      calls.push({ uri, position, includeDeclaration: options.includeDeclaration });
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

function commandOf(probeResult: ReturnType<typeof probeLanguageServer>): string {
  assert.equal(probeResult.available, true);
  if (!probeResult.available) throw new Error("unreachable");
  return probeResult.server.command;
}

describe("probeLanguageServer", () => {
  it("picks the server that matches the root's marker, when it is on PATH", () => {
    const result = probeLanguageServer(ROOT, {
      exists: existsOnly(ROOT, path.join(ROOT, "tsconfig.json")),
      probe: probeOnly("typescript-language-server", "gopls"),
    });

    assert.equal(result.available, true);
    if (!result.available) return;
    assert.equal(result.server.command, "typescript-language-server");
    assert.deepEqual(result.server.args, ["--stdio"]);
    assert.match(result.reason, /typescript-language-server found on PATH/);
    assert.match(result.reason, /tsconfig\.json/);
  });

  it("is honestly unavailable when the marker matches but nothing is installed", () => {
    const result = probeLanguageServer(ROOT, {
      exists: existsOnly(ROOT, path.join(ROOT, "go.mod")),
      probe: probeOnly("typescript-language-server", "pyright"),
    });

    assert.equal(result.available, false);
    if (result.available) return;
    assert.deepEqual(result.missing, ["gopls"]);
    assert.match(result.reason, /looks like go/);
    assert.match(result.reason, /gopls is not on PATH/);
  });

  it("does not offer a server for another language, even when that one is installed", () => {
    const result = probeLanguageServer(ROOT, {
      exists: existsOnly(ROOT, path.join(ROOT, "pyproject.toml")),
      probe: probeOnly("gopls"),
    });

    assert.equal(result.available, false);
    if (result.available) return;
    assert.deepEqual(result.missing, ["pyright"]);
    assert.match(result.reason, /looks like python/);
  });

  it("falls back to the first server on PATH when the root has no markers", () => {
    const result = probeLanguageServer(ROOT, {
      exists: existsOnly(ROOT),
      probe: probeOnly("gopls"),
    });

    assert.equal(commandOf(result), "gopls");
    assert.match(result.reason, /found on PATH$/);
  });

  it("names every command it looked for when none exists at all", () => {
    const result = probeLanguageServer(ROOT, {
      exists: existsOnly(ROOT),
      probe: probeOnly(),
    });

    assert.equal(result.available, false);
    if (result.available) return;
    assert.deepEqual(result.missing, ["typescript-language-server", "pyright", "gopls"]);
    assert.match(result.reason, /no language server on PATH/);
  });

  it("refuses a root that does not exist instead of guessing", () => {
    const result = probeLanguageServer(ROOT, { exists: existsOnly(), probe: probeOnly("gopls") });

    assert.equal(result.available, false);
    if (result.available) return;
    assert.match(result.reason, /no such directory/);
    assert.deepEqual(result.missing, []);
  });

  it("rejects an empty root", () => {
    assert.throws(() => probeLanguageServer("  "), /root must be a non-empty path/);
  });

  it("lists one spec per known server, each with argv and markers", () => {
    assert.deepEqual(
      LANGUAGE_SERVERS.map((server: LanguageServerSpec) => server.command),
      ["typescript-language-server", "pyright", "gopls"],
    );
    for (const server of LANGUAGE_SERVERS) {
      assert.ok(server.markers.length > 0, `${server.id} has markers`);
      assert.ok(Array.isArray(server.args), `${server.id} has argv`);
    }
  });
});

describe("pathProbe", () => {
  it("finds an executable in a PATH directory and nothing else", () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(path.join(tmpdir(), "roan-lsp-"));
    try {
      const bin = path.join(dir, "typescript-language-server");
      writeFileSync(bin, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(bin, 0o755);

      const probe = pathProbe({ PATH: dir });
      assert.equal(probe("typescript-language-server"), true);
      assert.equal(probe("gopls"), false);
      // An explicit path bypasses PATH lookup.
      assert.equal(probe(bin), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports nothing for an empty PATH", () => {
    assert.equal(pathProbe({ PATH: "" })("gopls"), false);
  });
});

describe("definitionAt", () => {
  it("asks with a file URI and a 0-based position, and returns the hits", async () => {
    const location = {
      uri: "file:///home/roan/project/src/a.ts",
      range: {
        start: { line: 9, character: 2 },
        end: { line: 9, character: 8 },
      },
    };
    const { client, calls } = recordingClient([location]);

    const hits = await definitionAt(client, path.join(ROOT, "src", "b.ts"), 10, 3);

    assert.deepEqual(hits, [location]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.uri, pathToFileURL(path.join(ROOT, "src", "b.ts")).href);
    assert.deepEqual(calls[0]?.position, { line: 9, character: 2 });
  });

  it("keeps a file:// path as it was given", async () => {
    const { client, calls } = recordingClient([]);
    await definitionAt(client, "file:///tmp/x.ts", 1, 1);

    assert.equal(calls[0]?.uri, "file:///tmp/x.ts");
  });

  it("turns an empty answer into an empty list", async () => {
    const { client } = recordingClient(null);
    assert.deepEqual(await definitionAt(client, "a.ts", 1, 1), []);
  });

  it("rejects a line or column below one", async () => {
    const { client } = recordingClient([]);
    await assert.rejects(() => definitionAt(client, "a.ts", 0, 1), /line must be a 1-based integer/);
    await assert.rejects(() => definitionAt(client, "a.ts", 1, 0), /col must be a 1-based integer/);
    await assert.rejects(() => definitionAt(client, "  ", 1, 1), /file must be a non-empty path/);
  });
});

describe("referencesAt", () => {
  it("includes the declaration by default and honours an explicit false", async () => {
    const { client, calls } = recordingClient([]);

    await referencesAt(client, "a.ts", 5, 5);
    await referencesAt(client, "a.ts", 5, 5, { includeDeclaration: false });

    assert.equal(calls[0]?.includeDeclaration, true);
    assert.equal(calls[1]?.includeDeclaration, false);
  });

  it("reads LocationLinks and drops duplicates", async () => {
    const link = {
      targetUri: "file:///home/roan/project/src/a.ts",
      targetRange: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
      targetSelectionRange: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } },
    };
    const { client } = recordingClient([link, link]);

    const hits = await referencesAt(client, "a.ts", 2, 5);

    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      uri: "file:///home/roan/project/src/a.ts",
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } },
    });
  });
});

describe("normalizeLocations", () => {
  it("accepts one location, an array, and skips shapes it cannot read", () => {
    const one = {
      uri: "file:///a.ts",
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
    };

    assert.deepEqual(normalizeLocations(one), [one]);
    assert.deepEqual(normalizeLocations([one, null, "nonsense", { uri: 3 }]), [one]);
    assert.deepEqual(normalizeLocations(undefined), []);
    assert.deepEqual(normalizeLocations({ uri: "file:///a.ts" }), []);
  });
});

describe("createCodeIntel", () => {
  it("binds one client to both queries", async () => {
    const { client, calls } = recordingClient([]);
    const intel = createCodeIntel(client);

    await intel.definitionAt("a.ts", 1, 1);
    await intel.referencesAt("a.ts", 1, 1, { includeDeclaration: false });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.includeDeclaration, undefined);
    assert.equal(calls[1]?.includeDeclaration, false);
  });

  it("builds the same URI as toUri", () => {
    assert.equal(toUri("a.ts"), pathToFileURL(path.resolve("a.ts")).href);
  });
});
