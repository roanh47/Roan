import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMessage } from "./commands.js";

const events = [
  { type: "command", data: { name: "review", prompt: "Review this carefully: $args" } },
  { type: "command", data: { name: "standup", prompt: "Write my standup." } },
  { type: "command", data: { name: "old", prompt: "x" } },
  { type: "command", data: { name: "old", removed: true } },
];

describe("resolveMessage", () => {
  it("expands a command the chain defines and keeps what was typed", () => {
    assert.deepEqual(resolveMessage("/review the parser", events), {
      prompt: "Review this carefully: the parser",
      typed: "/review the parser",
    });
  });

  it("appends the arguments when the prompt has no placeholder", () => {
    assert.deepEqual(resolveMessage("/standup short please", events), {
      prompt: "Write my standup.\n\nshort please",
      typed: "/standup short please",
    });
  });

  it("passes ordinary text, paths, unknown and removed commands through unchanged", () => {
    for (const text of ["hello", "/etc/hosts is odd", "/etc", "/nope do it", "/old thing", "see /review"]) {
      assert.deepEqual(resolveMessage(text, events), { prompt: text }, text);
    }
  });
});
