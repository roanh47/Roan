import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchHit } from "../web/types.js";
import { capBytes, resolveLimits, runResearch, type ResearchDeps } from "./run.js";

function hit(title: string, url: string, snippet = "a snippet"): SearchHit {
  return { title, url, snippet };
}

interface StubOptions {
  /** First model answer: the plan. An Error is thrown instead. */
  readonly plan?: string | Error;
  /** Later model answers: the report. An Error is thrown instead. */
  readonly report?: string | Error;
  readonly hits?: (query: string) => readonly SearchHit[];
  readonly pages?: Readonly<Record<string, string | Error>>;
  readonly onExtract?: (url: string) => void;
}

interface Stub {
  readonly deps: ResearchDeps;
  readonly calls: { search: string[]; extract: string[]; model: string[] };
}

function stub(options: StubOptions): Stub {
  const calls = { search: [] as string[], extract: [] as string[], model: [] as string[] };
  const deps: ResearchDeps = {
    async search(query) {
      calls.search.push(query);
      return options.hits?.(query) ?? [];
    },
    async extract(url) {
      calls.extract.push(url);
      options.onExtract?.(url);
      const page = options.pages?.[url];
      if (page === undefined) throw new Error(`no stub page for ${url}`);
      if (page instanceof Error) throw page;
      return page;
    },
    async model(prompt) {
      calls.model.push(prompt);
      // The loop's first model call plans; the later one writes the report.
      const scripted = calls.model.length === 1 ? options.plan : options.report;
      if (scripted instanceof Error) throw scripted;
      return scripted ?? "";
    },
  };
  return { deps, calls };
}

test("a full run plans, searches, extracts and cites every fetched source", async () => {
  const { deps, calls } = stub({
    plan: '["alpha", "beta"]',
    hits: (query) => [hit(`About ${query}`, `https://example.com/${query}`)],
    pages: {
      "https://example.com/alpha": "alpha page text",
      "https://example.com/beta": "beta page text",
    },
    report: "Alpha is real [1]. Beta agrees [2].",
  });

  const result = await runResearch("What is alpha?", deps);

  assert.equal(result.stopReason, "complete");
  assert.deepEqual(result.queries, ["alpha", "beta"]);
  assert.deepEqual(calls.search, ["alpha", "beta"]);
  assert.deepEqual(calls.extract, ["https://example.com/alpha", "https://example.com/beta"]);
  assert.equal(calls.model.length, 2);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.sources.map((source) => source.index), [1, 2]);
  assert.equal(result.report.citationIndex.get(1), "https://example.com/alpha");
  assert.equal(result.report.citationIndex.get(2), "https://example.com/beta");
  assert.match(result.report.markdown, /Alpha is real \[1\]/);
  assert.match(result.report.markdown, /## Sources/);
  assert.deepEqual(result.report.rejectedCitations, []);
});

test("only the top two https results per query are read", async () => {
  const { deps, calls } = stub({
    plan: '["q"]',
    hits: () => [
      hit("insecure", "http://example.com/plain"),
      hit("a", "https://example.com/a"),
      hit("b", "https://example.com/b"),
      hit("c", "https://example.com/c"),
    ],
    pages: { "https://example.com/a": "a", "https://example.com/b": "b" },
  });

  const result = await runResearch("q", deps);

  assert.deepEqual(calls.extract, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(result.sources.length, 2);
});

test("the same url found by two queries is fetched and cited once", async () => {
  const { deps, calls } = stub({
    plan: '["one", "two"]',
    hits: (query) =>
      query === "one"
        ? [hit("Same", "https://example.com/same")]
        : [hit("Same again", "https://example.com/same/")],
    pages: { "https://example.com/same": "same page" },
    report: "Only once [1].",
  });

  const result = await runResearch("q", deps);

  assert.deepEqual(calls.extract, ["https://example.com/same"]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.report.citationIndex.size, 1);
});

test("the extract budget is honoured and the report says it stopped", async () => {
  const { deps, calls } = stub({
    plan: '["one", "two", "three"]',
    hits: (query) => [
      hit("a", `https://example.com/${query}-a`),
      hit("b", `https://example.com/${query}-b`),
    ],
    pages: {
      "https://example.com/one-a": "a",
      "https://example.com/one-b": "b",
      "https://example.com/two-a": "c",
      "https://example.com/two-b": "d",
    },
  });

  const result = await runResearch("q", deps, { maxExtracts: 2 });

  assert.equal(calls.extract.length, 2);
  assert.equal(result.sources.length, 2);
  assert.equal(result.stopReason, "extract-limit");
  assert.match(result.notes.join("\n"), /2-page extract limit/);
});

test("the wall clock stops the loop and says so", async () => {
  let clock = 0;
  const { deps, calls } = stub({
    plan: '["one", "two"]',
    hits: (query) => [
      hit("a", `https://example.com/${query}-a`),
      hit("b", `https://example.com/${query}-b`),
    ],
    pages: {
      "https://example.com/one-a": "a",
      "https://example.com/one-b": "b",
    },
    onExtract: () => {
      clock += 30_000;
    },
  });

  const result = await runResearch("q", deps, { maxMilliseconds: 60_000, now: () => clock });

  assert.equal(calls.extract.length, 2);
  assert.equal(result.sources.length, 2);
  assert.equal(result.stopReason, "time-limit");
  assert.equal(result.elapsedMs, 60_000);
  assert.match(result.notes.join("\n"), /wall-clock limit/);
  // The budget ran out before the report model: sources are listed, not invented.
  assert.equal(calls.model.length, 1);
  assert.match(result.report.markdown, /could not be generated/);
});

test("empty search results produce an honest nothing-found report", async () => {
  const { deps, calls } = stub({ plan: '["nothing"]', hits: () => [] });

  const result = await runResearch("Is there anything?", deps);

  assert.equal(result.stopReason, "no-sources");
  assert.equal(result.sources.length, 0);
  assert.equal(result.report.citationIndex.size, 0);
  assert.match(result.report.markdown, /Nothing found/);
  assert.match(result.report.markdown, /_No sources were fetched\._/);
  // No sources means no report prompt: there is nothing honest to synthesise.
  assert.equal(calls.model.length, 1);
});

test("a page that fails to extract is left out of the sources and the citations", async () => {
  const { deps } = stub({
    plan: '["q"]',
    hits: () => [
      hit("good", "https://example.com/good"),
      hit("bad", "https://example.com/bad"),
    ],
    pages: {
      "https://example.com/good": "readable",
      "https://example.com/bad": new Error("connection reset"),
    },
    report: "Only the good page [1], never the bad one [2].",
  });

  const result = await runResearch("q", deps);

  assert.deepEqual(result.sources.map((source) => source.url), ["https://example.com/good"]);
  assert.match(result.notes.join("\n"), /could not read https:\/\/example\.com\/bad: connection reset/);
  assert.doesNotMatch(result.report.markdown, /\[2\]/);
  assert.equal(result.report.citationIndex.has(2), false);
});

test("a failed search is a note, not the end of the run", async () => {
  const { deps } = stub({
    plan: '["broken", "working"]',
    hits: (query) => {
      if (query === "broken") throw new Error("provider down");
      return [hit("ok", "https://example.com/ok")];
    },
    pages: { "https://example.com/ok": "text" },
    report: "It works [1].",
  });

  const result = await runResearch("q", deps);

  assert.match(result.notes.join("\n"), /search failed for "broken": provider down/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.stopReason, "complete");
});

test("a report-model failure still yields the fetched sources", async () => {
  const { deps } = stub({
    plan: '["q"]',
    hits: () => [hit("ok", "https://example.com/ok")],
    pages: { "https://example.com/ok": "text" },
    report: new Error("model down"),
  });

  const result = await runResearch("q", deps);

  assert.match(result.notes.join("\n"), /report model failed \(model down\)/);
  assert.match(result.report.markdown, /could not be generated/);
  assert.match(result.report.markdown, /https:\/\/example\.com\/ok/);
  assert.equal(result.report.citationIndex.size, 1);
});

test("a fabricated citation is rejected even when the model insists", async () => {
  const { deps } = stub({
    plan: '["q"]',
    hits: () => [hit("ok", "https://example.com/ok")],
    pages: { "https://example.com/ok": "text" },
    report: "Real [1]. Fabricated [9].",
  });

  const result = await runResearch("q", deps);

  assert.doesNotMatch(result.report.markdown, /\[9\]/);
  assert.deepEqual(result.report.rejectedCitations, [9]);
  assert.equal(result.report.citationIndex.size, 1);
});

test("planning failure falls back to the question and keeps going", async () => {
  const { deps, calls } = stub({
    plan: new Error("planner down"),
    hits: () => [hit("ok", "https://example.com/ok")],
    pages: { "https://example.com/ok": "text" },
    report: "Answer [1].",
  });

  const result = await runResearch("  a   question  ", deps);

  assert.deepEqual(result.queries, ["a question"]);
  assert.deepEqual(calls.search, ["a question"]);
  assert.match(result.notes.join("\n"), /planning failed \(planner down\)/);
  assert.equal(result.sources.length, 1);
});

test("a zero fan-out plans nothing and reports nothing found", async () => {
  const { deps, calls } = stub({ plan: '["x"]' });

  const result = await runResearch("q", deps, { maxSubQueries: 0 });

  assert.equal(calls.model.length, 0);
  assert.equal(result.stopReason, "no-queries");
  assert.equal(result.queries.length, 0);
  assert.match(result.report.markdown, /Nothing found/);
});

test("an empty question is rejected before any work", async () => {
  const { deps, calls } = stub({});
  await assert.rejects(runResearch("   ", deps), /research question is empty/);
  assert.equal(calls.model.length, 0);
  assert.equal(calls.search.length, 0);
});

test("caps cannot be raised past the feature ceilings", () => {
  const caps = resolveLimits({
    maxSubQueries: 99,
    maxExtracts: 99,
    maxMilliseconds: 999_999,
    resultsPerQuery: 99,
  });
  assert.equal(caps.maxSubQueries, 4);
  assert.equal(caps.maxExtracts, 8);
  assert.equal(caps.maxMilliseconds, 60_000);
  assert.equal(caps.resultsPerQuery, 2);
});

test("capBytes cuts on a character boundary", () => {
  assert.equal(capBytes("héllo", 2), "h");
  assert.equal(capBytes("héllo", 6), "héllo");
  assert.doesNotMatch(capBytes("héllo", 2), /\uFFFD/);
});
