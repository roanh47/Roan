import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir, removeTempDir, withTempDir } from "./temp-dir.js";

/** True when `target` exists, without caring why it would not. */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("makeTempDir", () => {
  it("creates an existing directory under the tmpdir with the requested prefix", async () => {
    const dir = await makeTempDir("roan-temp-test-");
    try {
      assert.ok(path.isAbsolute(dir), dir);
      assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
      assert.ok(path.basename(dir).startsWith("roan-temp-test-"), dir);
      assert.equal(await exists(dir), true);
    } finally {
      await removeTempDir(dir);
    }
  });

  it("gives each call its own directory, even with the same prefix", async () => {
    const first = await makeTempDir("roan-temp-uniek-");
    const second = await makeTempDir("roan-temp-uniek-");
    try {
      assert.notEqual(first, second);
      assert.equal(await exists(first), true);
      assert.equal(await exists(second), true);
    } finally {
      await removeTempDir(first);
      await removeTempDir(second);
    }
  });

  it("rejects an empty prefix and names the input", async () => {
    await assert.rejects(makeTempDir(""), (cause: unknown) => {
      assert.ok(cause instanceof Error);
      assert.match(cause.message, /prefix must not be empty/u);
      return true;
    });
  });

  it("rejects a prefix with a path separator and names the input", async () => {
    for (const prefix of ["roan/sub", "roan\\sub"]) {
      await assert.rejects(makeTempDir(prefix), (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /path separator/u);
        assert.ok(
          cause.message.includes(JSON.stringify(prefix)),
          `expected ${JSON.stringify(prefix)} in "${cause.message}"`,
        );
        return true;
      });
    }
  });
});

describe("removeTempDir", () => {
  it("removes a directory with contents, including subdirectories", async () => {
    const dir = await makeTempDir("roan-temp-rm-");
    const nested = path.join(dir, "sub");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(dir, "a.txt"), "inhoud", "utf8");
    await fs.writeFile(path.join(nested, "b.txt"), "inhoud", "utf8");

    await removeTempDir(dir);

    assert.equal(await exists(dir), false);
  });

  it("tolerates a path that is already gone", async () => {
    const dir = await makeTempDir("roan-temp-weg-");
    await removeTempDir(dir);
    assert.equal(await exists(dir), false);

    await removeTempDir(dir);
    await removeTempDir(path.join(dir, "bestaat-niet"));
  });
});

describe("withTempDir", () => {
  it("gives the callback a working directory and cleans it up afterwards", async () => {
    let seen = "";
    const result = await withTempDir(async (dir) => {
      seen = dir;
      assert.equal(await exists(dir), true);
      await fs.writeFile(path.join(dir, "notitie.txt"), "hallo", "utf8");
      return fs.readFile(path.join(dir, "notitie.txt"), "utf8");
    });

    assert.equal(result, "hallo");
    assert.notEqual(seen, "");
    assert.equal(await exists(seen), false);
  });

  it("returns the callback value, even when it is not a string", async () => {
    const value = await withTempDir(async (dir) => ({
      dir,
      answer: 42,
    }));

    assert.equal(value.answer, 42);
    assert.ok(path.isAbsolute(value.dir), value.dir);
    assert.equal(await exists(value.dir), false);
  });

  it("cleans up the directory and rethrows the error when the callback throws", async () => {
    let seen = "";
    const boom = new Error("opzettelijke fout");

    await assert.rejects(
      withTempDir(async (dir) => {
        seen = dir;
        await fs.writeFile(path.join(dir, "achterblijver.txt"), "x", "utf8");
        throw boom;
      }),
      (cause: unknown) => cause === boom,
    );

    assert.notEqual(seen, "");
    assert.equal(await exists(seen), false);
  });

  it("also cleans up when the callback throws synchronously", async () => {
    let seen = "";
    const boom = new Error("synchroon");

    await assert.rejects(
      withTempDir((dir) => {
        seen = dir;
        throw boom;
      }),
      (cause: unknown) => cause === boom,
    );

    assert.notEqual(seen, "");
    assert.equal(await exists(seen), false);
  });

  it("uses the given prefix for the directory name", async () => {
    let seen = "";
    await withTempDir(async (dir) => {
      seen = dir;
    }, "roan-temp-eigen-");

    assert.ok(path.basename(seen).startsWith("roan-temp-eigen-"), seen);
    assert.equal(await exists(seen), false);
  });
});
