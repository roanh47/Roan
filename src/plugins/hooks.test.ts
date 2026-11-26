import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOOK_EVENTS,
  isHookEvent,
  runHooks,
  type Hook,
  type HookRunner,
} from "./hooks.js";

interface Call {
  readonly command: string;
  readonly stdin: string;
}

/** A runner that records what it was handed and answers from a lookup table. */
function recording(): { runner: HookRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: HookRunner = async (command, stdin) => {
    calls.push({ command, stdin });
    return { exitCode: 0, output: `${command} ok` };
  };
  return { runner, calls };
}

function hook(id: string, event: string, command = id, timeoutMs?: number): Hook {
  return timeoutMs === undefined ? { id, event, command } : { id, event, command, timeoutMs };
}

test("only the hooks that belong to the event run, in declaration order", async () => {
  const { runner, calls } = recording();
  const hooks = [
    hook("a", "turn_start", "echo a"),
    hook("b", "turn_end", "echo b"),
    hook("c", "turn_start", "echo c"),
    hook("d", "before_tool", "echo d"),
  ];

  const report = await runHooks(hooks, "turn_start", {}, runner);

  assert.deepEqual(calls.map((call) => call.command), ["echo a", "echo c"]);
  assert.deepEqual(report.outcomes.map((outcome) => outcome.id), ["a", "c"]);
  assert.deepEqual(report.failures, []);
  assert.equal(report.event, "turn_start");
});

test("the payload reaches the runner as JSON on stdin", async () => {
  const { runner, calls } = recording();
  const payload = { text: 'a "quoted" line\nand a newline', count: 2 };

  await runHooks([hook("a", "after_tool")], "after_tool", payload, runner);

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]?.stdin ?? "null"), payload);
});

test("an undefined payload travels as JSON null, never as an empty stdin", async () => {
  const { runner, calls } = recording();
  await runHooks([hook("a", "turn_start")], "turn_start", undefined, runner);
  assert.equal(calls[0]?.stdin, "null");
});

test("a failing hook is collected and never stops the ones after it", async () => {
  const calls: string[] = [];
  const runner: HookRunner = async (command) => {
    calls.push(command);
    if (command === "explode") throw new Error("disk on fire");
    if (command === "exit2") return { exitCode: 2, output: "half done" };
    return { exitCode: 0, output: "fine" };
  };

  const report = await runHooks(
    [
      hook("first", "turn_start", "explode"),
      hook("second", "turn_start", "exit2"),
      hook("third", "turn_start", "works"),
    ],
    "turn_start",
    { turn: "t1" },
    runner,
  );

  assert.equal(calls.join(","), "explode,exit2,works");
  assert.deepEqual(report.outcomes.map((outcome) => outcome.id), ["first", "second", "third"]);
  assert.deepEqual(report.failures, [
    { id: "first", error: "disk on fire" },
    { id: "second", error: "exited with code 2" },
  ]);
  // The failure keeps what the command managed to say before it died.
  assert.equal(report.outcomes[1]?.output, "half done");
  // And the healthy hook still produced a result.
  assert.equal(report.outcomes[2]?.error, undefined);
  assert.equal(report.outcomes[2]?.output, "fine");
});

test("a hook that never answers becomes a timeout failure, not a hung turn", async () => {
  const calls: string[] = [];
  const runner: HookRunner = (command) => {
    calls.push(command);
    if (command === "hang") return new Promise(() => undefined);
    return Promise.resolve({ exitCode: 0, output: "quick" });
  };

  const report = await runHooks(
    [hook("slow", "turn_end", "hang", 5), hook("next", "turn_end", "quick")],
    "turn_end",
    { turn: "t2" },
    runner,
  );

  assert.deepEqual(calls, ["hang", "quick"]);
  assert.deepEqual(report.failures, [{ id: "slow", error: "timed out after 5ms" }]);
  assert.equal(report.outcomes[0]?.exitCode, null);
  assert.equal(report.outcomes[1]?.error, undefined);
});

test("an unknown event runs nothing and is not an error", async () => {
  const { runner, calls } = recording();
  const hooks = [hook("a", "turn_start"), hook("b", "before_lunch")];

  const unknown = await runHooks(hooks, "before_lunch", {}, runner);
  assert.equal(calls.length, 0);
  assert.deepEqual(unknown.outcomes, []);
  assert.deepEqual(unknown.failures, []);

  // A hook attached to a point the agent never reaches simply never runs.
  const known = await runHooks(hooks, "turn_start", {}, runner);
  assert.deepEqual(calls.map((call) => call.command), ["a"]);
  assert.equal(known.outcomes.length, 1);
});

test("no hooks at all is a clean, empty report", async () => {
  const { runner, calls } = recording();
  const report = await runHooks([], "turn_start", {}, runner);
  assert.deepEqual(calls, []);
  assert.deepEqual(report.outcomes, []);
  assert.deepEqual(report.failures, []);
});

test("the known points are the ones the turn actually reaches", () => {
  assert.deepEqual([...HOOK_EVENTS], ["turn_start", "turn_end", "before_tool", "after_tool"]);
  assert.equal(isHookEvent("turn_start"), true);
  assert.equal(isHookEvent("before_lunch"), false);
});
