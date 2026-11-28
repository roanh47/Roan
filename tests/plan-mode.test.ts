/**
 * Plan mode, end to end through the real turn runner and a scripted provider.
 *
 * The unit tests in `src/daemon/plan.test.ts` state the rule; this file proves
 * it holds where it matters: the tool list that actually goes over the wire, a
 * model that ignores the rule and asks for `write_file` anyway, the file that
 * must not appear on disk, and the approval that gives everything back.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EventStore } from "../src/chain/store.js";
import { approvePlan, planModeEnabled, planModeEvent } from "../src/daemon/plan.js";
import { runTurn } from "../src/daemon/turn-runner.js";
import type { Event } from "../src/protocol/types.js";
import { createStubProvider, type StubProvider } from "../src/testing/stub-provider.js";
import { withTempDir } from "../src/testing/temp-dir.js";
import { allTools } from "../src/tools.js";

const CHAIN = "chain-plan";
const NODE = "test-node";
const SESSION = "session-plan";

/** The names the provider was told this turn could call. */
function offeredTools(stub: StubProvider, requestIndex: number): string[] {
  const body = stub.requests[requestIndex]?.body;
  if (typeof body !== "object" || body === null) return [];
  const tools = (body as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return "";
      const fn = (entry as { function?: unknown }).function;
      if (typeof fn !== "object" || fn === null) return "";
      const name = (fn as { name?: unknown }).name;
      return typeof name === "string" ? name : "";
    })
    .filter((name) => name.length > 0);
}

/** The system message the provider received, which must say what mode we are in. */
function systemPromptOf(stub: StubProvider, requestIndex: number): string {
  const body = stub.requests[requestIndex]?.body;
  if (typeof body !== "object" || body === null) return "";
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return "";
  const first = messages[0];
  if (typeof first !== "object" || first === null) return "";
  const content = (first as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function append(store: EventStore, type: Event["type"], data: unknown): Event {
  return store.append(CHAIN, { id: randomUUID(), node: NODE, type, data }) as unknown as Event;
}

function readChain(store: EventStore): Event[] {
  return store.read(CHAIN, 1, 100_000) as unknown as Event[];
}

/** A store with one conversation in it, and plan mode on. */
function seedPlanMode(): EventStore {
  const store = EventStore.open(":memory:");
  append(store, "session", { id: SESSION, title: "Plan something" });
  append(store, "message", { text: "How would you fix the build?", session: SESSION });
  const payload = planModeEvent(SESSION, true);
  append(store, payload.type, payload.data as Record<string, unknown>);
  return store;
}

/** One turn through the real runner; the answer is irrelevant, the tools are not. */
async function runOneTurn(stub: StubProvider, store: EventStore, dir: string, planMode: boolean): Promise<void> {
  await runTurn(
    {
      store,
      chain: CHAIN,
      node: NODE,
      provider: { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" },
      cwd: dir,
      systemPrompt: "You are Roan.",
      tools: allTools(),
      session: SESSION,
      planMode,
      onAppend: () => undefined,
    },
    "How would you fix the build?",
  );
}

test("a plan-mode turn cannot write: the tool is absent, and a call for it is refused", async () => {
  const stub = await createStubProvider([
    {
      chunks: [{ id: "call-1", name: "write_file", arguments: JSON.stringify({ path: "out.txt", content: "hi" }) }],
    },
    { chunks: [{ content: "Here is the plan: read the failing test, then fix the parser." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedPlanMode();
      try {
        await runOneTurn(stub, store, dir, true);

        const names = offeredTools(stub, 0);
        assert.ok(names.includes("read_file"), `read_file must stay available, got ${names.join(", ")}`);
        assert.ok(names.includes("list_dir"), "list_dir must stay available in plan mode");
        assert.ok(!names.includes("write_file"), "write_file must not be offered while planning");
        assert.ok(!names.includes("run_shell"), "run_shell must not be offered while planning");
        assert.ok(!names.includes("apply_patch"), "apply_patch must not be offered while planning");
        assert.match(systemPromptOf(stub, 0), /Plan mode \(read-only\)/);

        // The model asked anyway. The call is refused by name, and nothing on
        // disk changed — this is the difference between a gate and a prompt.
        const refused = readChain(store).filter((event) => event.type === "tool_result");
        assert.equal(refused.length, 1, "the refused call is one tool_result");
        const result = refused[0]?.data as { name?: unknown; ok?: unknown; output?: unknown };
        assert.equal(result.name, "write_file");
        assert.equal(result.ok, false);
        assert.match(String(result.output), /plan mode is on: write_file/);
        assert.equal(existsSync(join(dir, "out.txt")), false, "plan mode wrote a file");

        // The report landed: a plan the user can read and approve.
        const answers = readChain(store)
          .filter((event) => event.type === "assistant")
          .map((event) => (event.data as { text?: unknown }).text);
        assert.ok(answers.some((text) => String(text).includes("Here is the plan")));
        assert.equal(planModeEnabled(readChain(store), SESSION), true);
      } finally {
        store.close();
      }
    }, "roan-plan-");
  } finally {
    await stub.close();
  }
});

test("approving the plan restores every tool and the write actually happens", async () => {
  const stub = await createStubProvider([
    { chunks: [{ content: "Plan: write out.txt with hi." }] },
    {
      chunks: [{ id: "call-2", name: "write_file", arguments: JSON.stringify({ path: "out.txt", content: "hi" }) }],
    },
    { chunks: [{ content: "Wrote out.txt." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedPlanMode();
      try {
        await runOneTurn(stub, store, dir, true);
        assert.equal(existsSync(join(dir, "out.txt")), false);

        // Approving is an event, not a client flag: the chain says the mode is
        // off and the next turn folds that to a full tool list.
        const approval = approvePlan(SESSION);
        assert.equal(approval.type, "plan_mode");
        append(store, approval.type, approval.data);
        const events = readChain(store);
        assert.equal(planModeEnabled(events, SESSION), false);

        const lastPlan = events.filter((event) => event.type === "plan_mode").at(-1);
        assert.deepEqual(lastPlan?.data, { session: SESSION, enabled: false });

        await runOneTurn(stub, store, dir, planModeEnabled(events, SESSION));

        const names = offeredTools(stub, 2);
        assert.ok(names.includes("write_file"), `write_file must be back, got ${names.join(", ")}`);
        assert.ok(names.includes("run_shell"), "run_shell must be back after approval");
        assert.ok(names.includes("read_file"), "approval must not drop the readers");
        assert.doesNotMatch(systemPromptOf(stub, 2), /Plan mode \(read-only\)/);

        assert.equal(existsSync(join(dir, "out.txt")), true, "the approved turn never wrote");
        assert.equal(readFileSync(join(dir, "out.txt"), "utf8"), "hi");
      } finally {
        store.close();
      }
    }, "roan-plan-approve-");
  } finally {
    await stub.close();
  }
});

test("plan mode is per conversation: another session keeps its tools", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "No plan here." }] }]);

  try {
    await withTempDir(async (dir) => {
      const store = seedPlanMode();
      try {
        append(store, "session", { id: "other", title: "Other" });
        const events = readChain(store);
        assert.equal(planModeEnabled(events, SESSION), true);
        assert.equal(planModeEnabled(events, "other"), false);

        await runTurn(
          {
            store,
            chain: CHAIN,
            node: NODE,
            provider: { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" },
            cwd: dir,
            systemPrompt: "You are Roan.",
            tools: allTools(),
            session: "other",
            planMode: planModeEnabled(events, "other"),
            onAppend: () => undefined,
          },
          "Anything to do here?",
        );

        const names = offeredTools(stub, 0);
        assert.ok(names.includes("write_file"), "a conversation that is not planning keeps its tools");
        assert.ok(names.includes("run_shell"));
      } finally {
        store.close();
      }
    }, "roan-plan-sessions-");
  } finally {
    await stub.close();
  }
});

test("a plan turn offers no shell and runs nothing, even when the model asks for it", async () => {
  const stub = await createStubProvider([
    {
      chunks: [{ id: "call-1", name: "run_shell", arguments: JSON.stringify({ command: "touch out.txt" }) }],
    },
    { chunks: [{ content: "Plan: nothing to run, this is research." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedPlanMode();
      try {
        await runTurn(
          {
            store,
            chain: CHAIN,
            node: NODE,
            provider: { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" },
            cwd: dir,
            systemPrompt: "You are Roan.",
            tools: allTools(),
            session: SESSION,
            planMode: true,
            onAppend: () => undefined,
          },
          "How would you fix the build?",
        );

        // Two requests: the refused tool call, then the plan.
        assert.equal(stub.requests.length, 2, "the turn must answer after the refused call");
        assert.ok(!offeredTools(stub, 0).includes("run_shell"));
        assert.equal(existsSync(join(dir, "out.txt")), false, "plan mode ran a shell command");
        const errors = readChain(store).filter((event) => event.type === "error");
        assert.equal(errors.length, 0, `a plan turn must not fail to start: ${JSON.stringify(errors)}`);
      } finally {
        store.close();
      }
    }, "roan-plan-engine-");
  } finally {
    await stub.close();
  }
});
