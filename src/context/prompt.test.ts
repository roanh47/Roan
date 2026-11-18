import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemPrompt } from "./prompt.js";

/**
 * The small-talk guard: fast models with tools attached reach for a tool on
 * any message, "Hi" included, and a tool loop can end a turn in silence. The
 * guard therefore ships in every prompt — fresh install or not.
 */
test("every prompt carries the small-talk guard", () => {
  const prompt = buildSystemPrompt({ base: "You are Roan." });
  assert.match(prompt, /Tools are for work, not conversation\./);
  assert.match(prompt, /no tool call at all/);
});

test("a fresh install stays quiet: only the base and the guard", () => {
  const prompt = buildSystemPrompt({ base: "You are Roan." });
  assert.ok(prompt.startsWith("You are Roan."));
  assert.doesNotMatch(prompt, /# Who you are working with/);
  assert.doesNotMatch(prompt, /# What you have learned/);
  assert.doesNotMatch(prompt, /# Skills/);
  assert.match(prompt, /# Tools/);
});

test("filled parts stack in order, guard always last", () => {
  const prompt = buildSystemPrompt({
    base: "You are Roan.",
    user: "likes short answers",
    memory: "a learned fact",
    skills: "- some skill",
  });
  const headers = [
    "You are Roan.",
    "# Who you are working with",
    "# What you have learned",
    "# Skills",
    "# Tools",
  ];
  const positions = headers.map((header) => prompt.indexOf(header));
  assert.ok(positions.every((position) => position >= 0), "every section is present");
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i]! > positions[i - 1]!,
      `section ${String(i)} must come after section ${String(i - 1)}`,
    );
  }
});
