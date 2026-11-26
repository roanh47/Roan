import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_CONTEXT_INSTRUCTIONS,
  ProjectError,
  createProject,
  listProjects,
  projectContext,
  projectFile,
  projectStore,
  requireProjectName,
  resolveProject,
  saveProject,
} from "./projects.js";

/** A fresh directory per test, removed afterwards. Never the real home. */
async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "roan-projects-"));
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await tempRoot();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a created project is a JSON file named after it", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "roan", dir: "/home/roan/Roan", instructions: "read AGENTS.md" });

    const file = path.join(root, "roan.json");
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(stored, {
      name: "roan",
      dir: "/home/roan/Roan",
      instructions: "read AGENTS.md",
    });
  });
});

test("create returns exactly what it stored", async () => {
  await withRoot(async (root) => {
    const project = createProject(root, { name: "site", dir: "/srv/site" });
    assert.deepEqual(project, { name: "site", dir: "/srv/site", instructions: "" });
    assert.deepEqual(resolveProject(root, "site"), project);
  });
});

test("an existing project is never overwritten by create", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "roan", dir: "/a", instructions: "first" });
    assert.throws(
      () => createProject(root, { name: "roan", dir: "/b", instructions: "second" }),
      /already exists/,
    );
    assert.equal(resolveProject(root, "roan")?.instructions, "first");
  });
});

test("save edits an existing project in place", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "roan", dir: "/a", instructions: "first" });
    saveProject(root, { name: "roan", dir: "/a", instructions: "second" });
    assert.equal(resolveProject(root, "roan")?.instructions, "second");
  });
});

test("list returns every project, sorted by name", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "zeta", dir: "/z" });
    createProject(root, { name: "alpha", dir: "/a" });
    createProject(root, { name: "mid-project", dir: "/m" });

    assert.deepEqual(listProjects(root).map((project) => project.name), ["alpha", "mid-project", "zeta"]);
  });
});

test("list ignores files that are not projects", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "roan", dir: "/a" });
    await writeFile(path.join(root, "README.md"), "not a project", "utf8");
    await writeFile(path.join(root, "Bad Name.json"), "{}", "utf8");
    await mkdir(path.join(root, "nested.json"));

    assert.deepEqual(listProjects(root).map((project) => project.name), ["roan"]);
  });
});

test("a root that does not exist yet has no projects", async () => {
  const missing = path.join(tmpdir(), `roan-projects-missing-${String(process.pid)}-${String(Date.now())}`);
  assert.deepEqual(listProjects(missing), []);
  assert.equal(resolveProject(missing, "roan"), null);
});

test("a missing project is an honest null", async () => {
  await withRoot(async (root) => {
    assert.equal(resolveProject(root, "nothing-here"), null);
  });
});

test("a corrupt project file is an error naming the file, not a silent null", async () => {
  await withRoot(async (root) => {
    await writeFile(path.join(root, "broken.json"), "{not json", "utf8");
    assert.throws(() => resolveProject(root, "broken"), /broken\.json/);

    await writeFile(path.join(root, "wrong.json"), JSON.stringify({ name: "other", dir: "/x", instructions: "" }), "utf8");
    assert.throws(() => resolveProject(root, "wrong"), ProjectError);

    await writeFile(path.join(root, "relative.json"), JSON.stringify({ name: "relative", dir: "somewhere", instructions: "" }), "utf8");
    assert.throws(() => resolveProject(root, "relative"), /relative dir/);
  });
});

test("names outside [a-z0-9-_] are refused", () => {
  for (const name of ["Roan", "has space", "semi;colon", "dot.dot", "slash/es", "back\\slash", "", "héllo", "a/b"]) {
    assert.throws(() => requireProjectName(name), ProjectError, `name ${JSON.stringify(name)}`);
  }
  assert.equal(requireProjectName("roan-2_x"), "roan-2_x");
});

test("a path-escape name never reaches the filesystem", async () => {
  await withRoot(async (root) => {
    const outside = path.join(root, "..", `escaped-${String(process.pid)}.json`);
    for (const name of ["../escaped", "..", ".", "a/../../b", "/etc/passwd"]) {
      assert.throws(() => resolveProject(root, name), ProjectError, `name ${JSON.stringify(name)}`);
      assert.throws(() => createProject(root, { name, dir: "/tmp" }), ProjectError);
    }
    assert.throws(() => projectFile(root, "../escaped"), ProjectError);
    await assert.rejects(readFile(outside, "utf8"));
  });
});

test("a name longer than the limit is refused", () => {
  assert.throws(() => requireProjectName("a".repeat(65)), /at most 64/);
  assert.equal(requireProjectName("a".repeat(64)).length, 64);
});

test("project dir must be absolute and non-empty", async () => {
  await withRoot(async (root) => {
    assert.throws(() => createProject(root, { name: "rel", dir: "relative/path" }), /absolute/);
    assert.throws(() => createProject(root, { name: "empty", dir: "  " }), /non-empty/);
    assert.throws(() => createProject(root, { name: "nul", dir: "/tmp/a\0b" }), /NUL/);
    assert.equal(resolveProject(root, "rel"), null);
  });
});

test("the context block names the project, its directory and its instructions", async () => {
  await withRoot(async (root) => {
    const project = createProject(root, {
      name: "roan",
      dir: "/home/roan/Roan",
      instructions: "Never touch src/daemon/main.ts.",
    });
    const context = projectContext(project);

    assert.equal(
      context,
      "Project: roan\nDirectory: /home/roan/Roan\nInstructions:\nNever touch src/daemon/main.ts.",
    );
  });
});

test("a project without instructions says so", async () => {
  await withRoot(async (root) => {
    const project = createProject(root, { name: "bare", dir: "/tmp/bare" });
    const context = projectContext(project);
    assert.match(context, /Instructions:\n\(none specified\)$/);
  });
});

test("a long instruction list is cut in the context block but kept in the file", async () => {
  await withRoot(async (root) => {
    const project = createProject(root, {
      name: "wordy",
      dir: "/tmp/wordy",
      instructions: "x".repeat(MAX_CONTEXT_INSTRUCTIONS + 500),
    });
    const context = projectContext(project);

    assert.ok(context.length < MAX_CONTEXT_INSTRUCTIONS + 200);
    assert.match(context, /…\(instructions truncated\)$/);
    assert.ok(project.instructions.length > MAX_CONTEXT_INSTRUCTIONS, "the file keeps them all");
  });
});

test("the bound store answers the same as the functions", async () => {
  await withRoot(async (root) => {
    const store = projectStore(root);
    store.create({ name: "roan", dir: "/home/roan/Roan", instructions: "be brief" });

    assert.equal(store.resolve("roan")?.instructions, "be brief");
    assert.deepEqual(store.list().map((project) => project.name), ["roan"]);
    assert.match(store.context(store.list()[0]!), /^Project: roan/);
    assert.equal(store.resolve("missing"), null);
  });
});

test("projects live under the root that was passed in, not a guessed home", async () => {
  await withRoot(async (root) => {
    createProject(root, { name: "scoped", dir: "/tmp/scoped" });
    assert.deepEqual(await readdir(root), ["scoped.json"]);
  });
});
