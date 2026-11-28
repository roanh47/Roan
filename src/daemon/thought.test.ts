import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPayload, type Stream } from "../providers/openai-compat.js";
import { createThought } from "./thought.js";

describe("reasoning of a turn", () => {
  it("joins the fragments in order", () => {
    const thought = createThought();
    thought.add("First I look. ");
    thought.add("");
    thought.add("Then I answer.");
    assert.equal(thought.text(), "First I look. Then I answer.");
  });

  it("is null when nothing, or only whitespace, was streamed", () => {
    assert.equal(createThought().text(), null);
    const blank = createThought();
    blank.add("  \n ");
    assert.equal(blank.text(), null);
  });

  it("caps a long thought and says so", () => {
    const thought = createThought(10);
    thought.add("12345678");
    thought.add("90abc");
    thought.add("more");
    assert.equal(thought.text(), "1234567890\n…(truncated)");
  });
});

describe("reasoning in an OpenAI-compatible stream", () => {
  function run(deltas: readonly Record<string, unknown>[]) {
    const state: Stream = { content: "", calls: new Map(), usage: null };
    const said: string[] = [];
    const thought: string[] = [];
    const listeners = { onDelta: (text: string) => said.push(text), onReasoning: (text: string) => thought.push(text) };
    for (const delta of deltas) applyPayload(state, JSON.stringify({ choices: [{ delta }] }), listeners);
    return { state, said, thought };
  }

  it("hands reasoning to its own listener and keeps it out of the answer", () => {
    const { state, said, thought } = run([
      { reasoning_content: "thinking " },
      { reasoning: "more" },
      { content: "Hello" },
    ]);
    assert.deepEqual(thought, ["thinking ", "more"]);
    assert.deepEqual(said, ["Hello"]);
    assert.equal(state.content, "Hello");
  });

  it("reports nothing for a provider that sends no reasoning", () => {
    const { thought } = run([{ content: "Hi" }, { reasoning_content: null }, { reasoning_content: "" }]);
    assert.deepEqual(thought, []);
  });
});
