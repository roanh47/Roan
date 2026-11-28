import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../types.js";
import { clearOldToolResults } from "./tool-clearing.js";

function turn(sizes: readonly number[]): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: "You are Roan." },
    { role: "user", content: "do the work" },
  ];
  sizes.forEach((size, index) => {
    const id = `call-${String(index)}`;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }],
    });
    messages.push({ role: "tool", tool_call_id: id, name: "read_file", content: "x".repeat(size) });
  });
  return messages;
}

const toolBodies = (messages: readonly ChatMessage[]): string[] =>
  messages.filter((message) => message.role === "tool").map((message) => String(message.content));

describe("clearing old tool results", () => {
  it("leaves a turn under its budget alone", () => {
    assert.equal(clearOldToolResults(turn([1000, 1000, 1000]), { budgetChars: 10_000, keep: 1 }), null);
  });

  it("clears the oldest results first and keeps the newest whole", () => {
    const cleared = clearOldToolResults(turn([5000, 5000, 5000, 5000]), { budgetChars: 12_000, keep: 2 });
    assert.ok(cleared);
    const bodies = toolBodies(cleared);
    assert.equal(bodies[0], "[tool output cleared to save context: 5000 characters]");
    assert.equal(bodies[1], "[tool output cleared to save context: 5000 characters]");
    assert.equal(bodies[2]?.length, 5000);
    assert.equal(bodies[3]?.length, 5000);
  });

  it("keeps roles, call ids and everything that is not a tool result", () => {
    const before = turn([5000, 5000, 5000]);
    const cleared = clearOldToolResults(before, { budgetChars: 6000, keep: 1 });
    assert.ok(cleared);
    assert.equal(cleared.length, before.length);
    cleared.forEach((message, index) => {
      assert.equal(message.role, before[index]?.role);
      assert.equal(message.tool_call_id, before[index]?.tool_call_id);
    });
    assert.equal(cleared[1]?.content, "do the work");
  });

  it("stops once it is well under the budget, and skips small results", () => {
    const cleared = clearOldToolResults(turn([100, 9000, 9000, 6000, 6000]), { budgetChars: 30_000, keep: 1 });
    assert.ok(cleared);
    const bodies = toolBodies(cleared);
    assert.equal(bodies[0]?.length, 100);
    assert.match(bodies[1] ?? "", /^\[tool output cleared/);
    assert.match(bodies[2] ?? "", /^\[tool output cleared/);
    assert.equal(bodies[3]?.length, 6000);
  });

  it("says there is nothing to do when only the kept results are large", () => {
    assert.equal(clearOldToolResults(turn([9000, 9000]), { budgetChars: 10_000, keep: 2 }), null);
    const once = clearOldToolResults(turn([9000, 9000, 9000]), { budgetChars: 10_000, keep: 2 });
    assert.ok(once);
    assert.equal(clearOldToolResults(once, { budgetChars: 10_000, keep: 2 }), null);
  });
});
