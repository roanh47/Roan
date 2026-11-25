import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanForSecrets } from "./secrets-scan.js";

/**
 * Tests live next to the code (src/tools/) because `npm test` runs node --test
 * over the compiled dist/**\/*.test.js; a top-level tests/ directory would fall
 * outside the rootDir of tsconfig.
 */

/** Temporary directories belong in the runner's scratch directory, not in /tmp. */
const TEMP_ROOT = process.env.TMPDIR ?? os.tmpdir();

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(TEMP_ROOT, "roan-secrets-"));
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

describe("scanForSecrets", () => {
  it("finds a provider key and redacts the preview", async () => {
    await withTempDir(async (dir) => {
      const secret = "sk-test0123456789abcdefghijklmnop";
      await write(dir, "src/config.ts", `const apiKey = "${secret}";\n`);

      const result = await scanForSecrets(dir);

      assert.equal(result.scanned, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.truncated, false);
      assert.equal(result.findings.length, 1);

      const finding = result.findings[0];
      assert.ok(finding);
      assert.equal(finding.kind, "openai-key");
      assert.equal(finding.file, "src/config.ts");
      assert.equal(finding.line, 1);
      assert.equal(finding.column, 17);
      assert.match(finding.preview, /^sk-t…mnop$/);
      assert.equal(finding.preview.includes(secret), false);
      assert.ok(finding.preview.length < secret.length);
    });
  });

  it("returns nothing for a clean file", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "notes.md", "# Notities\n\nGeen geheimen hier, alleen tekst.\n");

      const result = await scanForSecrets(dir);

      assert.deepEqual(result.findings, []);
      assert.equal(result.scanned, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.truncated, false);
    });
  });

  it("skips node_modules", async () => {
    await withTempDir(async (dir) => {
      await write(
        dir,
        "node_modules/pkg/index.js",
        'const token = "ghp_0123456789abcdefghijABCDEFGHIJ0123";\n',
      );

      const result = await scanForSecrets(dir);

      assert.deepEqual(result.findings, []);
      assert.equal(result.scanned, 0);
    });
  });

  it("skips binary files and counts them as skipped", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "clean.txt", "gewone tekst\n");
      await write(
        dir,
        "blob.bin",
        Buffer.from([0x73, 0x6b, 0x2d, 0x00, 0xff, 0x10, 0x41, 0x42, 0x43]),
      );

      const result = await scanForSecrets(dir);

      assert.equal(result.scanned, 1);
      assert.equal(result.skipped, 1);
      assert.deepEqual(result.findings, []);
    });
  });

  it("recognises assignments in .env, YAML and TOML", async () => {
    await withTempDir(async (dir) => {
      await write(
        dir,
        ".env",
        [
          "# API_KEY=genegeerdincommentaar",
          "API_KEY=abcdef1234567890ghij",
          'DB_PASSWORD="correcthorsebattery"',
          "PUBLIC_BASE=zichtbaar",
        ].join("\n") + "\n",
      );
      await write(dir, "config.yaml", "client_secret: s3cr3tValue98765432\n");
      await write(dir, "config.toml", 'token = "tok_abcdef1234567890"\n');

      const result = await scanForSecrets(dir);

      assert.equal(result.scanned, 3);
      assert.equal(result.findings.length, 4);

      const envFindings = result.findings.filter((f) => f.file === ".env");
      assert.equal(envFindings.length, 2);
      for (const finding of envFindings) {
        assert.equal(finding.kind, "assigned-credential");
      }

      const apiKeyFinding = envFindings.find((f) => f.line === 2);
      assert.ok(apiKeyFinding);
      assert.equal(apiKeyFinding.column, "API_KEY=".length + 1);
      assert.equal(apiKeyFinding.preview, "abcd…ghij");
      assert.equal(apiKeyFinding.preview.includes("abcdef1234567890ghij"), false);

      const passwordFinding = envFindings.find((f) => f.line === 3);
      assert.ok(passwordFinding);
      assert.equal(passwordFinding.preview.includes("correcthorsebattery"), false);

      const yamlFinding = result.findings.find((f) => f.file === "config.yaml");
      assert.ok(yamlFinding);
      assert.equal(yamlFinding.kind, "assigned-credential");
      assert.equal(yamlFinding.line, 1);

      const tomlFinding = result.findings.find((f) => f.file === "config.toml");
      assert.ok(tomlFinding);
      assert.equal(tomlFinding.kind, "assigned-credential");
    });
  });

  it("cuts off at maxFindings and sets truncated", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "a.txt", 'key = "sk-aaaaaaaaaaaaaaaaaaaaaaaa"\n');
      await write(dir, "b.txt", 'key = "sk-bbbbbbbbbbbbbbbbbbbbbbbb"\n');

      const result = await scanForSecrets(dir, { maxFindings: 1 });

      assert.equal(result.findings.length, 1);
      assert.equal(result.truncated, true);
    });
  });

  it("cuts off at maxFiles and sets truncated", async () => {
    await withTempDir(async (dir) => {
      await write(dir, "a.txt", "gewoon tekst\n");
      await write(dir, "b.txt", "ook gewoon tekst\n");

      const result = await scanForSecrets(dir, { maxFiles: 1 });

      assert.equal(result.scanned, 1);
      assert.equal(result.truncated, true);
    });
  });
});
