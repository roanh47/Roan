import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { DiscoveredFile } from "./discover.js";
import { discoverInstructionFiles } from "./discover.js";
import {
  IMPORT_PREFIX,
  assertSafeImportPath,
  importTargetName,
  toSnapshotEntries,
} from "./parse.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "roan-import-parse-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  const pending = dirs.splice(0);
  await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
});

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function discovered(path: string, bytes: number, kind: DiscoveredFile["kind"] = "agents"): DiscoveredFile {
  return { path, kind, bytes };
}

describe("toSnapshotEntries", () => {
  it("names an entry under imported/ and keeps its bytes intact", async () => {
    const dir = await tempDir();
    const source = join(dir, "AGENTS.md");
    const content = "# House rules\n\nBe direct.\n";
    await writeFile(source, content);

    const found = await discoverInstructionFiles([dir]);
    const entries = await toSnapshotEntries(found);

    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.ok(entry !== undefined);
    assert.equal(entry.path, `${IMPORT_PREFIX}/AGENTS.md`);
    assert.equal(entry.kind, "file");
    assert.equal(entry.encoding, "utf8");
    assert.equal(entry.content, content);
    assert.equal(entry.size, Buffer.byteLength(content, "utf8"));
    assert.equal(entry.sha256, sha256(content));
  });

  it("keeps dotfile names such as .cursorrules", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".cursorrules"), "always test\n");

    const entries = await toSnapshotEntries(await discoverInstructionFiles([dir]));
    assert.equal(entries[0]?.path, `${IMPORT_PREFIX}/.cursorrules`);
  });

  it("skips empty and whitespace-only files", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "");
    await writeFile(join(dir, "CLAUDE.md"), " \n\t\n");
    await writeFile(join(dir, "SOUL.md"), "who I am\n");

    const entries = await toSnapshotEntries(await discoverInstructionFiles([dir]));
    assert.deepEqual(
      entries.map((entry) => entry.path),
      [`${IMPORT_PREFIX}/SOUL.md`],
    );
  });

  it("disambiguates two files with the same name, deterministically", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await writeFile(join(dir, "a", "AGENTS.md"), "from a\n");
    await writeFile(join(dir, "b", "AGENTS.md"), "from b\n");

    const found = await discoverInstructionFiles([join(dir, "a"), join(dir, "b")]);
    const entries = await toSnapshotEntries(found);

    assert.deepEqual(
      entries.map((entry) => [entry.path, entry.content]),
      [
        [`${IMPORT_PREFIX}/AGENTS-2.md`, "from b\n"],
        [`${IMPORT_PREFIX}/AGENTS.md`, "from a\n"],
      ],
    );
  });

  it("produces the same names when the same input is parsed twice", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await writeFile(join(dir, "a", "AGENTS.md"), "a\n");
    await writeFile(join(dir, "b", "AGENTS.md"), "b\n");
    const found = await discoverInstructionFiles([join(dir, "a"), join(dir, "b")]);

    const first = await toSnapshotEntries(found);
    const second = await toSnapshotEntries(found);
    assert.deepEqual(
      first.map((entry) => entry.path),
      second.map((entry) => entry.path),
    );
    assert.deepEqual(
      first.map((entry) => entry.sha256),
      second.map((entry) => entry.sha256),
    );
  });

  it("refuses an escaping prefix", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "# a\n");
    const found = await discoverInstructionFiles([dir]);

    await assert.rejects(
      () => toSnapshotEntries(found, { prefix: "../outside" }),
      /traversing|escape/i,
    );
    await assert.rejects(() => toSnapshotEntries(found, { prefix: "/tmp/out" }), /relative/i);
  });

  it("refuses path escapes in a target name", () => {
    assert.throws(() => importTargetName("../../AGENTS.md"), /'\/'|traversing/i);
    assert.throws(() => importTargetName("sub/AGENTS.md"), /'\/'/);
    assert.throws(() => importTargetName("AGENTS\\md"), /import source name/);
    assert.throws(() => importTargetName(".."), /not a file/i);
    assert.throws(() => assertSafeImportPath("/etc/passwd"), /relative/i);
    assert.throws(() => assertSafeImportPath("a/../b"), /traversing/i);
    assert.throws(() => assertSafeImportPath("a//b"), /empty|traversing/i);
  });

  it("adds a numeric suffix when the caller already holds the name", () => {
    const taken = new Set([`${IMPORT_PREFIX}/CLAUDE.md`, `${IMPORT_PREFIX}/CLAUDE-2.md`]);
    assert.equal(importTargetName("CLAUDE.md", taken), `${IMPORT_PREFIX}/CLAUDE-3.md`);
  });

  it("skips non-UTF-8 content", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));

    const entries = await toSnapshotEntries(await discoverInstructionFiles([dir]));
    assert.deepEqual(entries, []);
  });

  it("skips a file whose reported size is over the cap without reading it", async () => {
    const dir = await tempDir();
    const source = join(dir, "AGENTS.md");
    await writeFile(source, "small on disk\n");

    const entries = await toSnapshotEntries([discovered(source, 100)], { maxBytes: 10 });
    assert.deepEqual(entries, []);
  });

  it("skips a file that grew past the cap since discovery", async () => {
    const dir = await tempDir();
    const source = join(dir, "AGENTS.md");
    await writeFile(source, "x".repeat(100));

    const entries = await toSnapshotEntries([discovered(source, 5)], { maxBytes: 50 });
    assert.deepEqual(entries, []);
  });

  it("skips a file that vanished after discovery", async () => {
    const dir = await tempDir();
    const entries = await toSnapshotEntries([discovered(join(dir, "AGENTS.md"), 10)]);
    assert.deepEqual(entries, []);
  });

  it("sorts entries by target path", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "SOUL.md"), "s\n");
    await writeFile(join(dir, "AGENTS.md"), "a\n");
    await writeFile(join(dir, "CLAUDE.md"), "c\n");

    const entries = await toSnapshotEntries(await discoverInstructionFiles([dir]));
    assert.deepEqual(
      entries.map((entry) => entry.path),
      [`${IMPORT_PREFIX}/AGENTS.md`, `${IMPORT_PREFIX}/CLAUDE.md`, `${IMPORT_PREFIX}/SOUL.md`],
    );
  });
});
