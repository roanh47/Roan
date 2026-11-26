/**
 * Plan mode is a rule about a tool list, so these tests state the rule in the
 * same terms: which names are offered while it is on, which are withheld, and
 * what the chain says once the plan is approved.
 *
 * The tool objects are real `Tool` shapes — not name strings — because the gate
 * is expected to hand back tools the agent can actually call.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvePlan,
  isForbiddenInPlanMode,
  isReadOnlyTool,
  PLAN_MODE_PROMPT,
  planModeEnabled,
  planModeEvent,
  planModeForbidden,
  planModeFromEvents,
  planModeRefusal,
  planModeTools,
} from "./plan.js";
import { allTools } from "../tools.js";
import type { Tool } from "../types.js";

/** A tool that does nothing; only its name and shape matter here. */
function tool(name: string): Tool {
  return {
    name,
    description: `${name} in a test`,
    parameters: { type: "object", properties: {} },
    async run() {
      return "ok";
    },
  };
}

const WRITE_AND_EXEC = ["write_file", "run_shell", "apply_patch", "edit_file", "delete_file", "create_file"];

const READ_ONLY = ["read_file", "list_dir", "search_files", "web_search", "web_fetch", "skill_view", "skill_file"];

const NAMES = [...WRITE_AND_EXEC, ...READ_ONLY, "delegate", "run_on_node", "memory"];
const TOOLS = NAMES.map(tool);

const namesOf = (tools: readonly Tool[]): string[] => tools.map((entry) => entry.name);

describe("plan mode withholds everything that writes or executes", () => {
  it("drops write and exec tools from the list the model sees", () => {
    const offered = namesOf(planModeTools(TOOLS, true));
    for (const name of WRITE_AND_EXEC) {
      assert.ok(!offered.includes(name), `${name} must not be offered in plan mode`);
    }
    // The tools the whole feature is about, by name, so a refactor cannot
    // quietly widen the allowlist.
    assert.ok(!offered.includes("write_file"));
    assert.ok(!offered.includes("run_shell"));
    assert.ok(!offered.includes("apply_patch"));
  });

  it("keeps the read-only tools, including an MCP tool named like a getter", () => {
    const offered = namesOf(planModeTools([...TOOLS, tool("mcp__brightspace__get_my_courses")], true));
    for (const name of READ_ONLY) {
      assert.ok(offered.includes(name), `${name} must stay available in plan mode`);
    }
    assert.ok(offered.includes("mcp__brightspace__get_my_courses"));
  });

  it("treats a tool it cannot classify as writing: unknown is not read-only", () => {
    assert.equal(isReadOnlyTool("delegate"), false);
    assert.equal(isReadOnlyTool("browser_exec"), false);
    assert.equal(isForbiddenInPlanMode("mcp__github__create_issue"), true);
    // A mutating verb anywhere wins over a reading word.
    assert.equal(isReadOnlyTool("get_and_delete"), false);
  });

  it("names exactly the tools it withheld, so the transcript can explain each", () => {
    const forbidden = namesOf(planModeForbidden(TOOLS));
    const offered = new Set(namesOf(planModeTools(TOOLS, true)));
    assert.deepEqual(
      [...forbidden].sort(),
      NAMES.filter((name) => !offered.has(name)).sort(),
    );
    assert.equal(planModeRefusal("write_file"), "plan mode is on: write_file is not available until the plan is approved");
  });

  it("leaves the real builtin set with readers and without writers", () => {
    const builtin = allTools();
    const offered = namesOf(planModeTools(builtin, true));
    assert.ok(offered.includes("read_file"));
    assert.ok(offered.includes("list_dir"));
    assert.ok(!offered.includes("write_file"));
    assert.ok(!offered.includes("run_shell"));
  });

  it("does not leave the gate in the system prompt only", () => {
    // The prompt says what to do; the mode is enforced by the list. Both have
    // to exist, or a chatty model can talk its way past the rule.
    assert.match(PLAN_MODE_PROMPT, /read-only/i);
    assert.match(PLAN_MODE_PROMPT, /do not write/);
  });
});

describe("approving a plan restores every tool", () => {
  it("hands the full list back once the mode is off", () => {
    assert.deepEqual(namesOf(planModeTools(TOOLS, false)), NAMES);
  });

  it("is a plan_mode event with enabled: false, and nothing else", () => {
    const payload = approvePlan("s1");
    assert.equal(payload.type, "plan_mode");
    assert.deepEqual(payload.data, { session: "s1", enabled: false });
  });

  it("refuses a session it could not address", () => {
    assert.throws(() => planModeEvent("", true), /session/);
    assert.throws(() => planModeEvent("   ", true), /session/);
  });
});

describe("the plan_mode event folds per conversation", () => {
  const event = (session: string, enabled: boolean, seq: number) => ({
    type: "plan_mode",
    data: { session, enabled },
    seq,
  });

  it("starts off, turns on, and turns off again in event order", () => {
    assert.equal(planModeEnabled([], "s1"), false);
    assert.equal(planModeEnabled([event("s1", true, 1)], "s1"), true);
    assert.equal(planModeEnabled([event("s1", true, 1), event("s1", false, 2)], "s1"), false);
  });

  it("keeps conversations apart: one planning does not plan the other", () => {
    const folded = planModeFromEvents([event("s1", true, 1), event("s2", false, 2)]);
    assert.equal(folded.get("s1"), true);
    assert.equal(folded.get("s2"), false);
    assert.equal(planModeEnabled([event("s1", true, 1)], "s2"), false);
    assert.equal(planModeEnabled([event("s1", true, 1)], undefined), false);
  });

  it("survives the newest answer: an approve followed by a new plan is on again", () => {
    const chain = [event("s1", true, 1), { type: "plan_mode", data: approvePlan("s1").data, seq: 2 }, event("s1", true, 3)];
    assert.equal(planModeEnabled(chain, "s1"), true);
  });

  it("ignores a malformed event instead of guessing", () => {
    const malformed = [
      { type: "plan_mode", data: null },
      { type: "plan_mode", data: { session: "", enabled: true } },
      { type: "plan_mode", data: { session: "s1", enabled: "yes" } },
      { type: "tool_rule", data: { session: "s1", enabled: true } },
    ];
    assert.equal(planModeFromEvents(malformed).size, 0);
  });
});
