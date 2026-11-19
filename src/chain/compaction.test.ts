import assert from "node:assert/strict";
import { test } from "node:test";

import { compactMessages, type ChatMessage } from "./compaction.js";

function chat(count: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ role: i % 2 === 0 ? "user" : "assistant", content: `bericht ${String(i)}` });
  }
  return out;
}

test("a short conversation rides along whole", () => {
  const compacted = compactMessages(chat(10), 40);
  assert.equal(compacted.digest, null);
  assert.equal(compacted.recent.length, 10);
});

test("past the window the older half becomes a digest and the recent stays whole", () => {
  const compacted = compactMessages(chat(60), 40);
  assert.notEqual(compacted.digest, null);
  assert.equal(compacted.recent.length, 40);
  // The whole recent block survived; the digest carries the first 20.
  assert.ok(compacted.digest?.includes("owner: bericht 0"));
  assert.ok(compacted.digest?.includes("roan: bericht 19"));
  assert.ok(!compacted.digest?.includes("bericht 20"));
  assert.equal(compacted.recent[0]?.content, "bericht 20");
});

test("long lines are cut to the digest width without breaking the facts", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "x".repeat(200) },
    ...chat(45),
  ];
  const compacted = compactMessages(messages, 40, 60);
  const firstLine = compacted.digest?.split("\n")[0] ?? "";
  assert.ok(firstLine.startsWith("owner: "));
  assert.ok(firstLine.length <= 60 + 10);
});
