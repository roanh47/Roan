import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanPrompt, DEFAULT_SUB_QUERIES, MAX_SUB_QUERIES, parseSubQueries, planSubQueries } from "./plan.js";

test("a JSON array of strings becomes the sub-queries, in order", () => {
  const answer = '["history of CSS", "CSS grid browser support"]';
  assert.deepEqual(parseSubQueries(answer), ["history of CSS", "CSS grid browser support"]);
});

test("a fenced JSON array wrapped in prose is still read", () => {
  const answer = 'Here are the queries:\n```json\n["alpha", "beta"]\n```\nGood luck!';
  assert.deepEqual(parseSubQueries(answer), ["alpha", "beta"]);
});

test("bullet and numbered lists are accepted when JSON is absent", () => {
  const answer = "- first query\n* second query\n1. third query\n2) fourth query";
  assert.deepEqual(parseSubQueries(answer), [
    "first query",
    "second query",
    "third query",
    "fourth query",
  ]);
});

test("an object wrapping an array is unwrapped", () => {
  assert.deepEqual(parseSubQueries('{"queries":["alpha","beta"]}'), ["alpha", "beta"]);
  assert.deepEqual(parseSubQueries('[{"query":"alpha"},{"query":"beta"}]'), ["alpha", "beta"]);
});

test("duplicates collapse across case and whitespace", () => {
  const answer = '["  CSS   GRID ", "css grid", "Flexbox"]';
  assert.deepEqual(parseSubQueries(answer), ["CSS GRID", "Flexbox"]);
});

test("quotes, bold markers and query labels are stripped", () => {
  const answer = '["**CSS grid**", "\\"flexbox\\"", "Query: css reset"]';
  assert.deepEqual(parseSubQueries(answer), ["CSS grid", "flexbox", "css reset"]);
});

test("the list is capped at the limit, and the limit never exceeds the hard ceiling", () => {
  const answer = JSON.stringify(["one", "two", "three", "four", "five", "six"]);
  assert.equal(parseSubQueries(answer).length, DEFAULT_SUB_QUERIES);
  assert.deepEqual(parseSubQueries(answer, 2), ["one", "two"]);
  assert.equal(parseSubQueries(answer, 99).length, MAX_SUB_QUERIES);
  assert.deepEqual(parseSubQueries(answer, 0), []);
});

test("prose without a list yields nothing, so the caller can fall back", () => {
  assert.deepEqual(parseSubQueries("I would search for CSS grid."), []);
  assert.deepEqual(parseSubQueries(""), []);
});

test("an unusable answer falls back to the question itself", async () => {
  const queries = await planSubQueries("How does CSS grid work?", {
    model: async () => "I would search for CSS grid.",
  });
  assert.deepEqual(queries, ["How does CSS grid work?"]);
});

test("the parsed list is what planSubQueries returns", async () => {
  const seen: string[] = [];
  const queries = await planSubQueries("CSS grid", {
    model: async (prompt) => {
      seen.push(prompt);
      return '["css grid history", "css grid support"]';
    },
  });
  assert.deepEqual(queries, ["css grid history", "css grid support"]);
  assert.match(seen[0] ?? "", /at most 4 short search queries/);
  assert.match(seen[0] ?? "", /JSON array/);
});

test("an empty question is rejected before the model is called", async () => {
  let calls = 0;
  await assert.rejects(
    planSubQueries("   ", { model: async () => ((calls += 1), "[]") }),
    /research question is empty/,
  );
  assert.equal(calls, 0);
});

test("a fan-out of zero plans nothing and does not call the model", async () => {
  let calls = 0;
  const queries = await planSubQueries("anything", {
    model: async () => ((calls += 1), '["x"]'),
  }, 0);
  assert.deepEqual(queries, []);
  assert.equal(calls, 0);
});

test("a model failure propagates so the run can note it", async () => {
  await assert.rejects(
    planSubQueries("anything", { model: async () => Promise.reject(new Error("model down")) }),
    /model down/,
  );
});

test("the plan prompt names the cap and keeps the question", () => {
  const prompt = buildPlanPrompt("  What   changed in CSS grid? ", 2);
  assert.match(prompt, /at most 2 short search queries/);
  assert.match(prompt, /What changed in CSS grid\?/);
});
