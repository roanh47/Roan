import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Tool } from "../types.js";
import { MINI_ROAN_BRIEF, miniRoanTools, runMiniRoan } from "./mini.js";

function tool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    async run() {
      return name;
    },
  };
}

describe("Mini Roan", () => {
  it("gets every tool except the one that starts another Mini Roan", () => {
    const names = miniRoanTools([tool("read_file"), tool("delegate"), tool("run_shell")]).map((entry) => entry.name);
    assert.deepEqual(names, ["read_file", "run_shell"]);
  });

  it("refuses an empty task before any request is made", async () => {
    await assert.rejects(
      runMiniRoan(
        {
          provider: { baseUrl: "http://127.0.0.1:9", apiKey: "", model: "none" },
          systemPrompt: "You are Roan.",
          tools: [],
          cwd: ".",
        },
        "   ",
      ),
      /needs a task/,
    );
  });

  it("is told it is Roan and that only its summary goes back", () => {
    assert.match(MINI_ROAN_BRIEF, /You are Roan/);
    assert.match(MINI_ROAN_BRIEF, /summary/);
  });
});
