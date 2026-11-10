import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { glob } from "./glob.js";

/**
 * Tests staan naast de code (src/tools/) omdat `npm test` node --test over de
 * gecompileerde dist/**\/*.test.js laat lopen; een top-level tests/ map zou
 * buiten rootDir van tsconfig vallen.
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
  it("geeft gesorteerde resultaten voor **/*.ts", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const results = await glob("**/*.ts", dir);

      assert.deepEqual(results, ["src/a.ts", "src/b.ts", "src/nested/c.ts", "src/nested/deep/d.ts"]);
      assert.deepEqual(results, [...results].sort());
    });
  });

  it("honoreert een genest patroon", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const direct = await glob("src/nested/*.ts", dir);
      assert.deepEqual(direct, ["src/nested/c.ts"]);

      const star = await glob("src/*.ts", dir);
      assert.deepEqual(star, ["src/a.ts", "src/b.ts"]);
    });
  });

  it("slaat node_modules en .git over", async () => {
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

  it("respecteert een kleine limit", async () => {
    await withTempDir(async (dir) => {
      await seed(dir);

      const full = await glob("**/*.ts", dir);
      const limited = await glob("**/*.ts", dir, { limit: 2 });

      assert.equal(limited.length, 2);
      assert.deepEqual(limited, full.slice(0, 2));
    });
  });

  it("geeft een lege lijst voor een onbekende map zonder te gooien", async () => {
    await withTempDir(async (dir) => {
      const results = await glob("**/*.ts", path.join(dir, "bestaat-niet"));
      assert.deepEqual(results, []);
    });
  });
});
