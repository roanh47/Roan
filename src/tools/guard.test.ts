import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Tool } from "../types.js";
import { dangerReason, guardTool, type ApprovalAnswer } from "./guard.js";

interface Asked {
  readonly tool: string;
  readonly reason: string | undefined;
}

function shell(ran: string[]): Tool {
  return {
    name: "run_shell",
    description: "test shell",
    parameters: { type: "object", properties: {} },
    async run(args) {
      const command = String(args["command"] ?? "");
      if (command === "boom") throw new Error("exit 1");
      ran.push(command);
      return "ok";
    },
  };
}

function asker(answer: ApprovalAnswer, asked: Asked[]) {
  return async (tool: string, _args: Record<string, unknown>, reason?: string): Promise<ApprovalAnswer> => {
    asked.push({ tool, reason });
    return answer;
  };
}

const ctx = { cwd: "." };

describe("tool guard", () => {
  it("names the danger of a destructive shell line and nothing else", () => {
    assert.match(dangerReason("run_shell", { command: "rm -rf /" }) ?? "", /delete/);
    assert.equal(dangerReason("run_shell", { command: "ls -la" }), null);
    assert.equal(dangerReason("run_shell", { command: "frobnicate --now" }), null);
    assert.equal(dangerReason("run_shell", { command: "" }), null);
    assert.equal(dangerReason("write_file", { command: "rm -rf /" }), null);
  });

  it("runs an ordinary call without asking", async () => {
    const ran: string[] = [];
    const asked: Asked[] = [];
    const tool = guardTool(shell(ran), { ask: false, askPermission: asker("deny", asked) });
    assert.equal(await tool.run({ command: "ls" }, ctx), "ok");
    assert.deepEqual(ran, ["ls"]);
    assert.equal(asked.length, 0);
  });

  it("asks with a reason before a dangerous line, even when the tool never asks", async () => {
    const ran: string[] = [];
    const asked: Asked[] = [];
    const tool = guardTool(shell(ran), { ask: false, askPermission: asker("allow", asked) });
    await tool.run({ command: "rm -rf /" }, ctx);
    assert.equal(asked.length, 1);
    assert.equal(typeof asked[0]?.reason, "string");
    assert.deepEqual(ran, ["rm -rf /"]);
  });

  it("does not run a dangerous line the owner refused", async () => {
    const ran: string[] = [];
    const tool = guardTool(shell(ran), { ask: false, askPermission: asker("deny", []) });
    await assert.rejects(tool.run({ command: "rm -rf /" }, ctx), /refused/);
    assert.deepEqual(ran, []);
  });

  it("refuses honestly when no answer arrives", async () => {
    const ran: string[] = [];
    const tool = guardTool(shell(ran), { ask: true, askPermission: asker("timeout", []) });
    await assert.rejects(tool.run({ command: "ls" }, ctx), /no approval arrived in time/);
    assert.deepEqual(ran, []);
  });

  it("asks without a reason for a tool the chain marked ask", async () => {
    const asked: Asked[] = [];
    const tool = guardTool(shell([]), { ask: true, askPermission: asker("allow", asked) });
    await tool.run({ command: "ls" }, ctx);
    assert.deepEqual(asked, [{ tool: "run_shell", reason: undefined }]);
  });

  it("fires the hooks around the call and reports a failed tool", async () => {
    const seen: string[] = [];
    const tool = guardTool(shell([]), {
      ask: false,
      askPermission: asker("allow", []),
      beforeTool: async (name) => {
        seen.push(`before ${name}`);
      },
      afterTool: async (name, ok) => {
        seen.push(`after ${name} ${String(ok)}`);
      },
    });
    await tool.run({ command: "ls" }, ctx);
    await assert.rejects(tool.run({ command: "boom" }, ctx), /exit 1/);
    assert.deepEqual(seen, [
      "before run_shell",
      "after run_shell true",
      "before run_shell",
      "after run_shell false",
    ]);
  });

  it("skips the hooks when the owner refused, and survives a hook that throws", async () => {
    const seen: string[] = [];
    const refused = guardTool(shell([]), {
      ask: true,
      askPermission: asker("deny", []),
      beforeTool: async () => {
        seen.push("before");
      },
    });
    await assert.rejects(refused.run({ command: "ls" }, ctx), /refused/);
    assert.deepEqual(seen, []);

    const broken = guardTool(shell([]), {
      ask: false,
      askPermission: asker("allow", []),
      beforeTool: async () => {
        throw new Error("hook broke");
      },
      afterTool: async () => {
        throw new Error("hook broke");
      },
    });
    assert.equal(await broken.run({ command: "ls" }, ctx), "ok");
  });
});
