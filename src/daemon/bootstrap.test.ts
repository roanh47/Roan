import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ensureBootstrapFiles, readGuideFile } from "./bootstrap.js";
import { buildSystemPrompt } from "../context/prompt.js";
import { resolvePaths } from "./paths.js";

/** The first start grows a home; the second start keeps the owner's edits. */
test("the bootstrap writes the guide files once and never over an edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-bootstrap-"));
  try {
    const paths = resolvePaths(join(root, ".Roan"));
    const created = await ensureBootstrapFiles(paths);
    assert.deepEqual(created, ["SOUL.md", "IDENTITY.md", "AGENTS.md"]);

    const again = await ensureBootstrapFiles(paths);
    assert.deepEqual(again, [], "an edited guide is never overwritten");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The style is a rule in the prompt: measure any answer against it. */
test("the guide files ride the system prompt as who-you-are and how-you-write", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-bootstrap-prompt-"));
  try {
    const paths = resolvePaths(join(root, ".Roan"));
    await ensureBootstrapFiles(paths);
    const prompt = buildSystemPrompt({
      base: "You are Roan.",
      soul: await readGuideFile(paths, "SOUL.md"),
      rules: await readGuideFile(paths, "AGENTS.md"),
    });
    assert.ok(prompt.includes("# Who you are"));
    assert.ok(prompt.includes("one agent, everywhere"));
    assert.ok(prompt.includes("# How you write — a rule, not a suggestion"));
    assert.ok(prompt.includes("No filler openings"));
    assert.ok(prompt.includes("Every answer is measured against this block"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
