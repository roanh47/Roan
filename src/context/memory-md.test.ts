import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";
import { EventStore } from "../chain/store.js";
import { distilMemories, type Conversation } from "../memory/distil.js";
import { foldMemoryMd, writeMemoryMd } from "./memory-md.js";

function event(seq: number, type: Event["type"], data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

function memory(seq: number, text: string, source = "s1"): Event {
  return event(seq, "memory", { text, source });
}

async function home(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "roan-memory-"));
}

test("the fold renders one bullet per fact, oldest first", () => {
  const md = foldMemoryMd([memory(1, "Works on Linux"), memory(2, "Uses Neovim")]);
  assert.equal(md, "- Works on Linux\n\n- Uses Neovim\n");
});

test("an empty chain folds to an empty file", () => {
  assert.equal(foldMemoryMd([]), "");
  assert.equal(foldMemoryMd([event(1, "message", { text: "hoi" })]), "");
});

test("shuffled events fold to the same bytes as ordered ones", () => {
  const ordered = [memory(1, "one"), memory(2, "two"), memory(3, "three")];
  const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
  assert.equal(foldMemoryMd(shuffled), foldMemoryMd(ordered));
});

test("a restated fact keeps one bullet and the newest text", () => {
  const md = foldMemoryMd([
    memory(1, "Works on Linux"),
    memory(2, "Uses Neovim"),
    memory(3, "works  on   linux"),
  ]);
  assert.equal(md, "- Uses Neovim\n\n- works on linux\n");
});

test("facts differing only in case or whitespace are one fact", () => {
  const md = foldMemoryMd([memory(1, "Uses  Neovim"), memory(2, "uses neovim")]);
  assert.equal(md, "- uses neovim\n");
});

test("malformed memory payloads are skipped, not fatal", () => {
  const md = foldMemoryMd([
    memory(1, "  "),
    memory(2, "Kept"),
    event(3, "memory", { note: "no text" }),
    event(4, "memory", null),
    event(5, "memory", "a bare string"),
  ]);
  assert.equal(md, "- Kept\n");
});

test("writeMemoryMd writes the file and reports it", async () => {
  const dir = await home();
  try {
    const written = await writeMemoryMd(dir, "- Works on Linux\n");
    assert.equal(written, true);
    assert.equal(await readFile(path.join(dir, "MEMORY.md"), "utf8"), "- Works on Linux\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unchanged file is never touched: same bytes, same inode", async () => {
  const dir = await home();
  try {
    const file = path.join(dir, "MEMORY.md");
    await writeMemoryMd(dir, "- Works on Linux\n");
    const before = await stat(file);

    const written = await writeMemoryMd(dir, "- Works on Linux\n");

    assert.equal(written, false);
    const after = await stat(file);
    assert.equal(after.ino, before.ino, "the file was replaced even though nothing changed");
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("changed content is written atomically and leaves no temp file", async () => {
  const dir = await home();
  try {
    const file = path.join(dir, "MEMORY.md");
    await writeMemoryMd(dir, "- Works on Linux\n");
    const before = await stat(file);

    const written = await writeMemoryMd(dir, "- Works on Linux\n\n- Uses Neovim\n");

    assert.equal(written, true);
    assert.equal(await readFile(file, "utf8"), "- Works on Linux\n\n- Uses Neovim\n");
    assert.notEqual((await stat(file)).ino, before.ino, "a rewrite must go through a rename");
    const leftovers = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no file is created when there is nothing to remember", async () => {
  const dir = await home();
  try {
    assert.equal(await writeMemoryMd(dir, ""), false);
    await assert.rejects(readFile(path.join(dir, "MEMORY.md"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an emptied chain clears the file rather than leaving stale facts", async () => {
  const dir = await home();
  try {
    const file = path.join(dir, "MEMORY.md");
    await writeFile(file, "- stale\n");
    assert.equal(await writeMemoryMd(dir, ""), true);
    assert.equal(await readFile(file, "utf8"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the home is created when it does not exist yet", async () => {
  const dir = await home();
  const nested = path.join(dir, "deep", "home");
  try {
    assert.equal(await writeMemoryMd(nested, "- Kept\n"), true);
    assert.equal(await readFile(path.join(nested, "MEMORY.md"), "utf8"), "- Kept\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty home is rejected instead of writing into the cwd", async () => {
  await assert.rejects(writeMemoryMd("  ", "- Kept\n"), /home directory is empty/);
});

test("a finished session becomes the next MEMORY.md, through the store", async () => {
  const dir = await home();
  const store = EventStore.open(":memory:");
  try {
    const conversation: Conversation = {
      session: "s9",
      messages: [{ role: "user", text: "Ik gebruik Neovim op Debian." }],
    };
    const facts = await distilMemories(conversation, [], async () =>
      '["Uses Neovim", "Works on Debian"]',
    );
    for (const [index, fact] of facts.entries()) {
      store.append("c", {
        id: `m${String(index)}`,
        node: "n",
        type: "memory",
        data: fact,
        ts: index,
      });
    }

    const written = await writeMemoryMd(dir, foldMemoryMd(store.read("c")));

    assert.equal(written, true);
    assert.equal(
      await readFile(path.join(dir, "MEMORY.md"), "utf8"),
      "- Uses Neovim\n\n- Works on Debian\n",
    );
    // The payload the store kept is the fact and its session, not the prompt.
    assert.deepEqual(store.read("c")[0]?.data, { text: "Uses Neovim", source: "s9" });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
