import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMany } from "./read-many.js";

/**
 * Tests staan naast de code (src/tools/) omdat `npm test` node --test over de
 * gecompileerde dist/**\/*.test.js laat lopen; een top-level tests/ map zou
 * buiten rootDir van tsconfig vallen.
 */

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "roan-read-many-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("readMany", () => {
  it("leest drie kleine bestanden en sorteert op pad", async () => {
    await withTempDir(async (dir) => {
      const c = path.join(dir, "c.txt");
      const a = path.join(dir, "a.txt");
      const b = path.join(dir, "b.txt");
      await fs.writeFile(c, "alpha", "utf8");
      await fs.writeFile(a, "charlie", "utf8");
      await fs.writeFile(b, "bravo", "utf8");

      const result = await readMany([c, a, b]);

      assert.equal(result.truncated, false);
      assert.deepEqual(
        result.results.map((entry) => entry.path),
        [a, b, c],
      );
      assert.deepEqual(result.results, [
        { path: a, ok: true, text: "charlie" },
        { path: b, ok: true, text: "bravo" },
        { path: c, ok: true, text: "alpha" },
      ]);
      assert.equal(result.totalChars, "charlie".length + "bravo".length + "alpha".length);
    });
  });

  it("meldt een ontbrekend bestand als fout zonder te gooien", async () => {
    await withTempDir(async (dir) => {
      const ok = path.join(dir, "ok.txt");
      const missing = path.join(dir, "ontbreekt.txt");
      await fs.writeFile(ok, "inhoud", "utf8");

      const result = await readMany([missing, ok]);

      assert.deepEqual(result.results[0], { path: ok, ok: true, text: "inhoud" });
      const failed = result.results[1];
      assert.ok(failed !== undefined);
      assert.equal(failed.ok, false);
      assert.equal(failed.path, missing);
      if (failed.ok) throw new Error("verwachtte een fout");
      assert.ok(failed.error.length > 0);
      assert.ok(failed.error.includes("ontbreekt.txt"), failed.error);
      assert.equal(result.truncated, false);
      assert.equal(result.totalChars, "inhoud".length);
    });
  });

  it("rapporteert een binair bestand als fout in plaats van het te decoderen", async () => {
    await withTempDir(async (dir) => {
      const text = path.join(dir, "tekst.txt");
      const binary = path.join(dir, "beeld.bin");
      await fs.writeFile(text, "gewoon tekst", "utf8");
      await fs.writeFile(binary, Buffer.from([0x50, 0x4e, 0x47, 0x00, 0xff, 0x01]));

      const result = await readMany([text, binary]);

      assert.deepEqual(result.results[0], { path: binary, ok: false, error: `binary file: ${binary}` });
      assert.deepEqual(result.results[1], { path: text, ok: true, text: "gewoon tekst" });
      assert.equal(result.truncated, false);
      assert.equal(result.totalChars, "gewoon tekst".length);
    });
  });

  it("kapt af op het tekenbudget en markeert de rest", async () => {
    await withTempDir(async (dir) => {
      const first = path.join(dir, "a.txt");
      const second = path.join(dir, "b.txt");
      await fs.writeFile(first, "0123456789", "utf8");
      await fs.writeFile(second, "abcdefghij", "utf8");

      const result = await readMany([first, second], { maxTotalChars: 6 });

      assert.equal(result.truncated, true);
      const [head, tail] = result.results;
      assert.ok(head !== undefined && tail !== undefined);
      assert.equal(head.path, first);
      assert.equal(head.ok, true);
      if (!head.ok) throw new Error("verwachtte tekst");
      assert.ok(head.text.startsWith("012345"));
      assert.ok(head.text.endsWith("[truncated]"), head.text);
      assert.deepEqual(tail, { path: second, ok: false, error: "not read: character budget exhausted" });
      assert.equal(result.totalChars, head.text.length);
      assert.ok(result.totalChars <= 6 + "\n[truncated]".length);
    });
  });

  it("leest niets zodra het budget nul is", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "leeg-budget.txt");
      await fs.writeFile(file, "x", "utf8");

      const result = await readMany([file], { maxTotalChars: 0 });

      assert.equal(result.truncated, true);
      assert.deepEqual(result.results, [
        { path: file, ok: false, error: "not read: character budget exhausted" },
      ]);
      assert.equal(result.totalChars, 0);
    });
  });
});
