import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { glob } from "./glob.js";

/**
 * Tests live next to the code (src/tools/) because `npm test` runs node --test
 * over the compiled dist/**\/*.test.js; a top-level tests/ directory would fall
 * outside the rootDir of tsconfig.
 */

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "roan-glob-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function write(dir: string, rel: string): Promise<void> {
  const target = path.join(dir, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `// ${rel}\n`, "utf8");
}

async function seed(dir: string): Promise<void> {
  await write(dir, "src/a.ts");
  await write(dir, "src/b.ts");
  await write(dir, "src/nested/c.ts");
  await write(dir, "src/nested/deep/d.ts");
  await write(dir, "README.md");
  await write(dir, "node_modules/pkg/index.ts");
  await write(dir, "node_modules/pkg/deep/x.ts");
  await write(dir, ".git/hooks/y.ts");
}

describe("glob", () => {
  it("returns sorted results for **/*.ts", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const results = await glob("**/*.ts", dir);

      assert.deepEqual(results, ["src/a.ts", "src/b.ts", "src/nested/c.ts", "src/nested/deep/d.ts"]);
      assert.deepEqual(results, [...results].sort());
    });
  });

  it("honours a nested pattern", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const direct = await glob("src/nested/*.ts", dir);
      assert.deepEqual(direct, ["src/nested/c.ts"]);

      const star = await glob("src/*.ts", dir);
      assert.deepEqual(star, ["src/a.ts", "src/b.ts"]);
    });
  });

  it("skips node_modules and .git", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const all = await glob("**/*", dir);
      assert.ok(all.length > 0);
      for (const rel of all) {
        assert.ok(!rel.split("/").includes("node_modules"), `node_modules in ${rel}`);
        assert.ok(!rel.split("/").includes(".git"), `.git in ${rel}`);
      }

      const ts = await glob("**/*.ts", dir);
      assert.equal(
        ts.some((rel) => rel.startsWith("node_modules/") || rel.startsWith(".git/")),
        false,
      );
    });
  });

  it("respects a small limit", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const full = await glob("**/*.ts", dir);
      const limited = await glob("**/*.ts", dir, { limit: 2 });

      assert.equal(limited.length, 2);
      assert.deepEqual(limited, full.slice(0, 2));
    });
  });

  it("returns an empty list for an unknown directory without throwing", async () => {
    await withTempDir(async (dir) => {
      const results = await glob("**/*.ts", path.join(dir, "bestaat-niet"));
      assert.deepEqual(results, []);
    });
  });
});
