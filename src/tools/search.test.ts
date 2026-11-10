import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { grep } from "./search.js";

/**
 * Tests staan naast de code (src/tools/) omdat `npm test` node --test over de
 * gecompileerde dist/**\/*.test.js laat lopen; een top-level tests/ map zou
 * buiten rootDir van tsconfig vallen.
 */

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "roan-search-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function write(dir: string, rel: string, content: string | Buffer): Promise<void> {
  const target = path.join(dir, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

describe("grep", () => {
  it("vindt treffers met 1-based regelnummers", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "a.ts", ["const alpha = 1;", "const beta = 2;", "const alpha = 3;", ""].join("\n"));

      const result = await grep("alpha", dir);

      assert.equal(result.error, undefined);
      assert.equal(result.truncated, false);
      assert.equal(result.matches.length, 2);
      const first = result.matches[0];
      const second = result.matches[1];
      assert.ok(first);
      assert.ok(second);
      assert.equal(first.line, 1);
      assert.equal(second.line, 3);
      assert.match(first.file, /a\.ts$/);
      assert.match(first.text, /alpha = 1/);
      assert.match(second.text, /alpha = 3/);
    });
  });

  it("respecteert maxResults en zet truncated", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "many.txt", Array.from({ length: 6 }, (_, i) => `hit ${i}`).join("\n") + "\n");

      const limited = await grep("hit", dir, { maxResults: 2 });
      assert.equal(limited.matches.length, 2);
      assert.equal(limited.truncated, true);

      const roomy = await grep("hit", dir, { maxResults: 100 });
      assert.equal(roomy.matches.length, 6);
      assert.equal(roomy.truncated, false);
    });
  });

  it("slaat binaire bestanden over", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "text.txt", "NEEDLE in tekst\n");
      await write(dir, "blob.bin", Buffer.from([0x4e, 0x45, 0x45, 0x44, 0x4c, 0x45, 0x00, 0xff, 0x10]));

      const result = await grep("NEEDLE", dir);

      assert.equal(result.matches.length, 1);
      const only = result.matches[0];
      assert.ok(only);
      assert.match(only.file, /text\.txt$/);
    });
  });

  it("geeft een error-string in plaats van te gooien bij een ongeldige regex", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "a.ts", "const alpha = 1;\n");

      const result = await grep("(", dir);

      assert.equal(typeof result.error, "string");
      assert.ok((result.error ?? "").length > 0);
      assert.deepEqual(result.matches, []);
    });
  });

  it("meldt een ontbrekend pad zonder te gooien", async () => {
    await withTempDir(async (dir) => {
      const missing = path.join(dir, "bestaat-niet");

      const result = await grep("iets", missing);

      assert.deepEqual(result.matches, []);
      assert.equal(typeof result.error, "string");
      assert.ok((result.error ?? "").length > 0);
    });
  });

  it("ondersteunt ignoreCase, literal en include", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "code.ts", "const HELLO = 'axb';\n");
      await write(dir, "notes.md", "hello en axb\n");

      const sensitiveLower = await grep("hello", dir);
      assert.equal(sensitiveLower.matches.length, 1);
      const lowerHit = sensitiveLower.matches[0];
      assert.ok(lowerHit);
      assert.match(lowerHit.file, /notes\.md$/);

      const sensitiveUpper = await grep("HELLO", dir);
      assert.equal(sensitiveUpper.matches.length, 1);
      const upperHit = sensitiveUpper.matches[0];
      assert.ok(upperHit);
      assert.match(upperHit.file, /code\.ts$/);

      const insensitive = await grep("helLo", dir, { ignoreCase: true });
      assert.equal(insensitive.matches.length, 2);

      const asRegex = await grep("axb", dir);
      assert.equal(asRegex.matches.length, 2);

      const asLiteral = await grep("a.b", dir, { literal: true });
      assert.equal(asLiteral.matches.length, 0);

      const dotRegex = await grep("a.b", dir);
      assert.equal(dotRegex.matches.length, 2);

      // `include` is een extensiefilter (".ts" of "ts"), geen glob.
      const onlyTs = await grep("axb", dir, { include: ".ts" });
      assert.equal(onlyTs.matches.length, 1);
      const tsHit = onlyTs.matches[0];
      assert.ok(tsHit);
      assert.match(tsHit.file, /code\.ts$/);

      const bareTs = await grep("axb", dir, { include: "ts" });
      assert.equal(bareTs.matches.length, 1);
    });
  });
});
