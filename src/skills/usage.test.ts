import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skillUsage, skillVerdict } from "./usage.js";

const DAY = 24 * 3_600_000;

const view = (name: string, ts: number) => ({
  type: "tool_call",
  ts,
  data: { name: "skill_view", args: JSON.stringify({ name }) },
});

describe("skill usage", () => {
  it("counts how often each skill was opened and when last", () => {
    const usage = skillUsage([
      view("deploy", 100),
      view("deploy", 300),
      view("review", 200),
      { type: "tool_call", ts: 400, data: { name: "read_file", args: '{"name":"deploy"}' } },
      { type: "message", ts: 500, data: { name: "skill_view", args: '{"name":"deploy"}' } },
    ]);
    assert.deepEqual(usage.get("deploy"), { uses: 2, lastUsed: 300 });
    assert.deepEqual(usage.get("review"), { uses: 1, lastUsed: 200 });
    assert.equal(usage.size, 2);
  });

  it("reads arguments as an object too, and skips what it cannot read", () => {
    const usage = skillUsage([
      { type: "tool_call", data: { name: "skill_view", args: { name: " deploy " } } },
      { type: "tool_call", data: { name: "skill_view", args: "not json" } },
      { type: "tool_call", data: { name: "skill_view", args: "{}" } },
      { type: "tool_call", data: null },
    ]);
    assert.deepEqual(usage.get("deploy"), { uses: 1, lastUsed: null });
    assert.equal(usage.size, 1);
  });

  it("says in words what the numbers mean", () => {
    const now = 100 * DAY;
    assert.equal(skillVerdict(undefined, now), "never used");
    assert.equal(skillVerdict({ uses: 1, lastUsed: now - DAY }, now), "used once");
    assert.equal(skillVerdict({ uses: 7, lastUsed: now - DAY }, now), "used 7 times");
    assert.equal(skillVerdict({ uses: 7, lastUsed: now - 40 * DAY }, now), "used 7 times, not in the last month");
    assert.equal(skillVerdict({ uses: 2, lastUsed: null }, now), "used 2 times");
  });
});
