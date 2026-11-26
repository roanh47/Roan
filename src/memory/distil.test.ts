import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMORY_CAP,
  buildDistilPrompt,
  distilMemories,
  memoryTexts,
  normaliseFact,
  parseFacts,
  type Conversation,
  type DistilModel,
} from "./distil.js";
import type { Event } from "../protocol/types.js";

function conversation(session = "s1"): Conversation {
  return {
    session,
    messages: [
      { role: "user", text: "Ik werk op Linux en houd van korte antwoorden." },
      { role: "assistant", text: "Genoteerd." },
    ],
  };
}

function stub(answer: string, prompts?: string[]): DistilModel {
  return async (prompt) => {
    prompts?.push(prompt);
    return answer;
  };
}

function event(seq: number, type: Event["type"], data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

test("a JSON array of strings is the preferred answer", () => {
  const facts = parseFacts('["Works on Linux", "Prefers short answers"]');
  assert.deepEqual(facts, ["Works on Linux", "Prefers short answers"]);
});

test("a fenced JSON array is accepted too", () => {
  const facts = parseFacts('Here you go:\n```json\n["Runs Debian \\"trixie\\""]\n```\n');
  assert.deepEqual(facts, ['Runs Debian "trixie"']);
});

test("bullet lines work when the model ignores the JSON instruction", () => {
  const facts = parseFacts("- Works on Linux\n* Prefers short answers\n• Uses Neovim\n");
  assert.deepEqual(facts, ["Works on Linux", "Prefers short answers", "Uses Neovim"]);
});

test("numbered lines count as a list", () => {
  assert.deepEqual(parseFacts("1. Works on Linux\n2) Uses Neovim\n"), [
    "Works on Linux",
    "Uses Neovim",
  ]);
});

test("prose with no list yields nothing", () => {
  assert.deepEqual(parseFacts("The user seems to like Linux, I think."), []);
});

test("an empty answer, broken JSON and a JSON object all yield nothing", () => {
  assert.deepEqual(parseFacts(""), []);
  assert.deepEqual(parseFacts('["unterminated"'), []);
  assert.deepEqual(parseFacts('{"text": "not a list"}'), []);
});

test("an array of non-strings is dropped, not coerced", () => {
  assert.deepEqual(parseFacts('[{"text":"a"}, 42, null]'), []);
});

test("empties and duplicates inside one answer are dropped", () => {
  assert.deepEqual(parseFacts('["  ", "Works on Linux", "works   on linux", ""]'), [
    "Works on Linux",
  ]);
});

test("the answer is capped at three facts", () => {
  const facts = parseFacts('["een","twee","drie","vier","vijf"]');
  assert.equal(facts.length, MEMORY_CAP);
  assert.deepEqual(facts, ["een", "twee", "drie"]);
});

test("normalisation ignores case and whitespace, not words", () => {
  assert.equal(normaliseFact("  Works   on\nLinux "), "works on linux");
  assert.notEqual(normaliseFact("works on linux"), normaliseFact("works on macos"));
});

test("distilled facts carry text and the session as source", async () => {
  const facts = await distilMemories(
    conversation("session-7"),
    [],
    stub('["Works on Linux", "Prefers short answers"]'),
  );
  assert.deepEqual(facts, [
    { text: "Works on Linux", source: "session-7" },
    { text: "Prefers short answers", source: "session-7" },
  ]);
  // Exactly the event payload: no session on every fact, no extra fields.
  for (const fact of facts) assert.deepEqual(Object.keys(fact).sort(), ["source", "text"]);
});

test("facts already remembered are not distilled again", async () => {
  const facts = await distilMemories(
    conversation(),
    ["works   ON linux"],
    stub('["Works on Linux", "Prefers short answers"]'),
  );
  assert.deepEqual(facts.map((fact) => fact.text), ["Prefers short answers"]);
});

test("duplicates across one answer collapse after cleaning", async () => {
  const facts = await distilMemories(
    conversation(),
    [],
    stub("- Uses Neovim\n- uses neovim \n- Uses Neovim nightly"),
  );
  assert.deepEqual(facts.map((fact) => fact.text), ["Uses Neovim", "Uses Neovim nightly"]);
});

test("a conversation with no text never calls the model", async () => {
  let calls = 0;
  const model: DistilModel = async () => {
    calls += 1;
    return '["should not happen"]';
  };
  const facts = await distilMemories(
    { session: "s1", messages: [{ role: "user", text: "   " }] },
    [],
    model,
  );
  assert.deepEqual(facts, []);
  assert.equal(calls, 0);
});

test("the prompt carries the conversation and what is already remembered", async () => {
  const prompts: string[] = [];
  await distilMemories(conversation(), ["Uses Neovim"], stub("[]", prompts));
  const prompt = prompts[0] ?? "";
  assert.match(prompt, /User: Ik werk op Linux/);
  assert.match(prompt, /Assistant: Genoteerd\./);
  assert.match(prompt, /Uses Neovim/);
  assert.match(prompt, /at most 3 strings/);
});

test("buildDistilPrompt says when nothing is remembered yet", () => {
  const prompt = buildDistilPrompt(conversation(), []);
  assert.match(prompt, /Nothing is remembered yet\./);
});

test("memoryTexts folds memory events only, newest text per fact", () => {
  const events: Event[] = [
    event(1, "message", { text: "hoi" }),
    event(2, "memory", { text: "Works on Linux", source: "s1" }),
    event(3, "memory", { text: "Uses Neovim", source: "s1" }),
    event(4, "memory", { text: "works on  LINUX", source: "s2" }),
    event(5, "memory", { text: 42, source: "s2" }),
    event(6, "memory", null),
  ];
  assert.deepEqual(memoryTexts(events), ["Uses Neovim", "works on LINUX"]);
});
