import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  MAX_INSTRUCTION_BYTES,
  discoverInstructionFiles,
  kindForInstructionFile,
} from "./discover.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "roan-import-discover-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  const pending = dirs.splice(0);
  await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("discoverInstructionFiles", () => {
  it("recognises every supported instruction file kind", async () => {
    const dir = await tempDir();
    const names = [
      "AGENTS.md",
      "CLAUDE.md",
      ".cursorrules",
      ".windsurfrules",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "MEMORY.md",
      "TOOLS.md",
    ];
    for (const name of names) await writeFile(join(dir, name), `# ${name}\n`);
    await writeFile(join(dir, "notes.txt"), "not an instruction file\n");

    const found = await discoverInstructionFiles([dir]);
    const byName = new Map(found.map((file) => [file.path.split("/").at(-1), file.kind]));

    assert.equal(found.length, names.length);
    assert.equal(byName.get("AGENTS.md"), "agents");
    assert.equal(byName.get("CLAUDE.md"), "claude");
    assert.equal(byName.get(".cursorrules"), "cursor");
    assert.equal(byName.get(".windsurfrules"), "windsurf");
    assert.equal(byName.get("SOUL.md"), "soul");
    assert.equal(byName.get("IDENTITY.md"), "identity");
    assert.equal(byName.get("USER.md"), "user");
    assert.equal(byName.get("MEMORY.md"), "memory");
    assert.equal(byName.get("TOOLS.md"), "openclaw");
    assert.equal(byName.has("notes.txt"), false);
  });

  it("finds Claude Code's nested instruction file", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "CLAUDE.md"), "# nested\n");

    const found = await discoverInstructionFiles([dir]);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, "claude");
    assert.equal(found[0]?.path, join(dir, ".claude", "CLAUDE.md"));
  });

  it("can be told to stay at the top level", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "CLAUDE.md"), "# nested\n");
    await writeFile(join(dir, "AGENTS.md"), "# top\n");

    const found = await discoverInstructionFiles([dir], { nested: false });
    assert.deepEqual(
      found.map((file) => file.path.split("/").at(-1)),
      ["AGENTS.md"],
    );
  });

  it("accepts an explicit file, and ignores an unknown explicit file", async () => {
    const dir = await tempDir();
    const agents = join(dir, "AGENTS.md");
    const other = join(dir, "notes.md");
    await writeFile(agents, "# agents\n");
    await writeFile(other, "# notes\n");

    const found = await discoverInstructionFiles([agents, other]);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.path, agents);
    assert.equal(found[0]?.bytes, 9);
  });

  it("skips a file above the 64 kB cap and keeps one exactly at it", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), Buffer.alloc(MAX_INSTRUCTION_BYTES, "a"));
    await writeFile(join(dir, "CLAUDE.md"), Buffer.alloc(MAX_INSTRUCTION_BYTES + 1, "a"));

    const found = await discoverInstructionFiles([dir]);
    assert.deepEqual(
      found.map((file) => file.path.split("/").at(-1)),
      ["AGENTS.md"],
    );
    assert.equal(found[0]?.bytes, MAX_INSTRUCTION_BYTES);
  });

  it("honours a lower custom cap", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "12345");
    await writeFile(join(dir, "CLAUDE.md"), "1234");

    const found = await discoverInstructionFiles([dir], { maxBytes: 4 });
    assert.deepEqual(
      found.map((file) => file.path.split("/").at(-1)),
      ["CLAUDE.md"],
    );
  });

  it("skips symlinks instead of following them", async () => {
    const dir = await tempDir();
    const real = join(dir, "real-agents.md");
    await writeFile(real, "# real\n");
    await symlink(real, join(dir, "AGENTS.md"));

    const found = await discoverInstructionFiles([dir]);
    assert.deepEqual(found, []);
  });

  it("dedupes a file offered twice and sorts by path", async () => {
    const dir = await tempDir();
    const agents = join(dir, "AGENTS.md");
    const claude = join(dir, "CLAUDE.md");
    await writeFile(agents, "# agents\n");
    await writeFile(claude, "# claude\n");

    const found = await discoverInstructionFiles([dir, agents, dir]);
    assert.deepEqual(
      found.map((file) => file.path),
      [agents, claude].sort(),
    );
  });

  it("ignores paths that do not exist and empty candidates", async () => {
    const dir = await tempDir();
    const found = await discoverInstructionFiles([join(dir, "missing"), "", "   "]);
    assert.deepEqual(found, []);
  });

  it("maps names without touching the disk", () => {
    assert.equal(kindForInstructionFile("AGENTS.md"), "agents");
    assert.equal(kindForInstructionFile("CLAUDE.md"), "claude");
    assert.equal(kindForInstructionFile("BOOTSTRAP.md"), "openclaw");
    assert.equal(kindForInstructionFile("agents.md"), null);
    assert.equal(kindForInstructionFile("random.md"), null);
  });
});
