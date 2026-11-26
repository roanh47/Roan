import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMMAND_PLACEHOLDER,
  commandList,
  expandCommand,
  foldCommands,
  parseCommandLine,
  type CommandEventLike,
} from "./commands.js";

function event(type: string, data: unknown): CommandEventLike {
  return { type, data };
}

function defined(name: string, prompt: string): CommandEventLike {
  return event("command", { name, prompt });
}

function removed(name: string): CommandEventLike {
  return event("command", { name, removed: true });
}

test("a slash line splits into a single-word name and the rest", () => {
  assert.deepEqual(parseCommandLine("/review src/app.ts --deep"), {
    name: "review",
    args: "src/app.ts --deep",
  });
});

test("a bare name is a command with no arguments", () => {
  assert.deepEqual(parseCommandLine("/help"), { name: "help", args: "" });
  assert.deepEqual(parseCommandLine("/help "), { name: "help", args: "" });
});

test("padding around the line is not part of the name or the arguments", () => {
  assert.deepEqual(parseCommandLine("   /say   hello  there  "), {
    name: "say",
    args: "hello  there",
  });
  // The inner spacing of what was typed survives untouched.
  const parsed = parseCommandLine("/say a  b");
  assert.ok(parsed !== null);
  assert.equal(parsed.args, "a  b");
});

test("text that does not start with a slash is a message, not a command", () => {
  assert.equal(parseCommandLine("review the parser"), null);
  assert.equal(parseCommandLine("what does /review do?"), null);
  assert.equal(parseCommandLine(""), null);
  assert.equal(parseCommandLine("   "), null);
});

test("a slash with no word after it is refused, not read as an empty command", () => {
  assert.equal(parseCommandLine("/"), null);
  assert.equal(parseCommandLine("/   "), null);
  assert.equal(parseCommandLine("/\ttabbed"), null);
  assert.equal(parseCommandLine("/  two spaces then a word"), null);
});

test("a name is one word: a slash inside it is not a name", () => {
  assert.equal(parseCommandLine("/foo/bar"), null);
  assert.equal(parseCommandLine("/../escape"), null);
});

test("the newest definition wins", () => {
  const commands = foldCommands([
    defined("review", "first wording"),
    defined("standup", "what moved yesterday"),
    defined("review", "second wording"),
  ]);

  assert.equal(commands.get("review")?.prompt, "second wording");
  assert.equal(commands.get("standup")?.prompt, "what moved yesterday");
  assert.deepEqual([...commands.keys()], ["review", "standup"]);
});

test("a tombstone removes the name and leaves the chain's history alone", () => {
  const events = [defined("review", "look closely"), defined("review", "look closely, twice")];
  assert.equal(foldCommands(events).get("review")?.prompt, "look closely, twice");

  const afterRemoval = foldCommands([...events, removed("review")]);
  assert.equal(afterRemoval.has("review"), false);
  assert.equal(afterRemoval.size, 0);
});

test("a definition after a tombstone brings the name back", () => {
  const commands = foldCommands([
    defined("review", "old"),
    removed("review"),
    defined("review", "new"),
  ]);
  assert.equal(commands.get("review")?.prompt, "new");
});

test("a tombstone for a name that was never defined is a quiet no-op", () => {
  const commands = foldCommands([removed("ghost")]);
  assert.equal(commands.size, 0);
});

test("malformed command payloads are skipped, never guessed at", () => {
  const commands = foldCommands([
    defined("", "no name"),
    defined("   ", "blank name"),
    defined("two words", "a name is one word"),
    defined("noprompt", ""),
    event("command", { name: "missing-prompt" }),
    event("command", { prompt: "no name at all" }),
    event("command", null),
    event("command", ["not", "a", "record"]),
    event("message", { name: "not-a-command-event", prompt: "x" }),
    defined("kept", "the only usable one"),
  ]);

  assert.deepEqual([...commands.keys()], ["kept"]);
});

test("the list is sorted by name so a menu keeps its order", () => {
  const commands = foldCommands([
    defined("zeta", "z"),
    defined("alpha", "a"),
    defined("mid", "m"),
  ]);
  assert.deepEqual(
    commandList(commands).map((command) => command.name),
    ["alpha", "mid", "zeta"],
  );
});

test("with a placeholder the typed arguments take its place", () => {
  const commands = foldCommands([defined("review", `Review ${COMMAND_PLACEHOLDER} closely.`)]);
  assert.deepEqual(expandCommand("review", "src/app.ts", commands), {
    ok: true,
    prompt: "Review src/app.ts closely.",
  });
});

test("every placeholder is filled", () => {
  const commands = foldCommands([defined("repeat", "$args and again $args")]);
  assert.deepEqual(expandCommand("repeat", "once", commands), {
    ok: true,
    prompt: "once and again once",
  });
});

test("without a placeholder the arguments ride along after a blank line", () => {
  const commands = foldCommands([defined("standup", "Say what moved yesterday.")]);
  assert.deepEqual(expandCommand("standup", "the hooks landed", commands), {
    ok: true,
    prompt: "Say what moved yesterday.\n\nthe hooks landed",
  });
});

test("without a placeholder and without arguments the prompt is untouched", () => {
  const commands = foldCommands([defined("standup", "Say what moved yesterday.")]);
  assert.deepEqual(expandCommand("standup", "   ", commands), {
    ok: true,
    prompt: "Say what moved yesterday.",
  });
});

test("an unknown command is an error that names what was typed", () => {
  const commands = foldCommands([defined("review", "look closely")]);
  const expansion = expandCommand("revieww", "x", commands);
  assert.equal(expansion.ok, false);
  if (expansion.ok) return;
  assert.match(expansion.error, /unknown command/);
  assert.match(expansion.error, /revieww/);
});

test("an empty command name is refused instead of resolving to nothing", () => {
  const expansion = expandCommand("   ", "x", new Map());
  assert.equal(expansion.ok, false);
  if (expansion.ok) return;
  assert.match(expansion.error, /no command name/);
});
