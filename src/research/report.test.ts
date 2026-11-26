import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, citationIndex, sanitiseCitations, type ResearchSource } from "./report.js";

function source(index: number, url: string, title = `Source ${String(index)}`): ResearchSource {
  return { index, title, url, snippet: `snippet ${String(index)}`, bytes: 10 };
}

test("the report ends with a numbered Sources list built from fetched sources", () => {
  const sources = [source(1, "https://example.com/a"), source(2, "https://example.com/b")];
  const report = buildReport({ question: "Why?", body: "Because [1]. Also [2].", sources });

  assert.match(report.markdown, /^# Why\?/);
  assert.match(report.markdown, /1\. \[Source 1\]\(https:\/\/example\.com\/a\)/);
  assert.match(report.markdown, /2\. \[Source 2\]\(https:\/\/example\.com\/b\)/);
  assert.match(report.markdown, /## Sources/);
  assert.equal(report.rejectedCitations.length, 0);
});

test("the citation index maps every kept marker to a real url", () => {
  const sources = [source(1, "https://example.com/a"), source(2, "https://example.com/b")];
  const report = buildReport({ question: "Why?", body: "One [1], two [2].", sources });

  assert.equal(report.citationIndex.size, 2);
  assert.equal(report.citationIndex.get(1), "https://example.com/a");
  assert.equal(report.citationIndex.get(2), "https://example.com/b");
});

test("a fabricated citation is stripped and never enters the index", () => {
  const sources = [source(1, "https://example.com/a")];
  const report = buildReport({ question: "Why?", body: "Real [1]. Invented [9].", sources });

  assert.match(report.markdown, /Real \[1\]\./);
  assert.doesNotMatch(report.markdown, /\[9\]/);
  assert.deepEqual(report.rejectedCitations, [9]);
  assert.equal(report.citationIndex.has(9), false);
  assert.equal(report.citationIndex.size, 1);
});

test("a mixed marker keeps its real half and drops the invented one", () => {
  const report = buildReport({
    question: "Why?",
    body: "Both agree [1, 9].",
    sources: [source(1, "https://example.com/a")],
  });

  assert.match(report.markdown, /Both agree \[1\]\./);
  assert.doesNotMatch(report.markdown, /\[1, 9\]/);
  assert.deepEqual(report.rejectedCitations, [9]);
});

test("a report with no fetched sources says so instead of inventing a list", () => {
  const report = buildReport({ question: "Why?", body: "Nothing found.", sources: [] });

  assert.match(report.markdown, /_No sources were fetched\._/);
  assert.equal(report.citationIndex.size, 0);
  assert.doesNotMatch(report.markdown, /^\d+\. \[/m);
});

test("notes are rendered as bullets between the body and the sources", () => {
  const report = buildReport({
    question: "Why?",
    body: "Because [1].",
    sources: [source(1, "https://example.com/a")],
    notes: [" search stopped early ", ""],
  });

  assert.match(report.markdown, /## Notes\n\n- search stopped early/);
  assert.ok(report.markdown.indexOf("## Notes") < report.markdown.indexOf("## Sources"));
});

test("an empty body becomes an explicit line, not a blank section", () => {
  const report = buildReport({ question: "Why?", body: "   ", sources: [] });
  assert.match(report.markdown, /_Nothing was written\._/);
});

test("brackets in a title cannot break the markdown link", () => {
  const report = buildReport({
    question: "Why?",
    body: "Because [1].",
    sources: [source(1, "https://example.com/a", "A [bracket] title")],
  });
  assert.match(report.markdown, /\[A \\\[bracket\\\] title\]\(https:/);
});

test("sanitiseCitations leaves unknown markers out and reports them once", () => {
  const result = sanitiseCitations("A [2] B [2] C [4]", new Set([2]));
  assert.equal(result.text, "A [2] B [2] C");
  assert.deepEqual(result.rejected, [4]);
});

test("citationIndex keeps one url per number", () => {
  const index = citationIndex([source(1, "https://example.com/a"), source(1, "https://example.com/b")]);
  assert.equal(index.size, 1);
  assert.equal(index.get(1), "https://example.com/a");
});
