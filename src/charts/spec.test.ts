import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chartMarkdown,
  formatNumber,
  MAX_CHART_POINTS,
  MAX_TABLE_ROWS,
  parseChartSpec,
  readTabular,
} from "./spec.js";

const VALID = { type: "bar", title: "Bezoek", labels: ["ma", "di"], values: [3, 7] };

function spec(overrides: Record<string, unknown>): unknown {
  return { ...VALID, ...overrides };
}

test("a valid spec parses with the title trimmed", () => {
  const parsed = parseChartSpec(JSON.stringify({ ...VALID, title: "  Bezoek  " }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.spec.type, "bar");
  assert.equal(parsed.spec.title, "Bezoek");
  assert.deepEqual([...parsed.spec.values], [3, 7]);
});

test("a spec without a title is allowed and titled later, not invented", () => {
  const parsed = parseChartSpec(JSON.stringify({ type: "pie", labels: ["a"], values: [1] }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.spec.title, "");
  assert.match(chartMarkdown(parsed.spec), /^### Chart$/mu);
});

test("the cap is 50 points: 50 pass, 51 is refused with both numbers", () => {
  const points = Array.from({ length: MAX_CHART_POINTS }, (_value, index) => index + 1);
  const labels = points.map((point) => `p${String(point)}`);
  assert.equal(parseChartSpec(JSON.stringify({ type: "line", labels, values: points })).ok, true);

  const tooMany = [...points, 51];
  const refused = parseChartSpec(JSON.stringify({ type: "line", labels: [...labels, "p51"], values: tooMany }));
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.match(refused.error, /at most 50 points, got 51/);
});

test("invalid specs each name their own problem", () => {
  const cases: { text: string; message: RegExp }[] = [
    { text: "", message: /nothing to read/ },
    { text: "{", message: /not valid JSON/ },
    { text: "[]", message: /expected an object/ },
    { text: JSON.stringify(spec({ type: "scatter" })), message: /type must be one of/ },
    { text: JSON.stringify(spec({ type: undefined })), message: /type must be one of/ },
    { text: JSON.stringify(spec({ title: 3 })), message: /title must be a string/ },
    { text: JSON.stringify(spec({ labels: "ma,di" })), message: /labels must be an array of strings/ },
    { text: JSON.stringify(spec({ labels: ["ma", 2] })), message: /labels must be an array of strings/ },
    { text: JSON.stringify(spec({ values: [1, "2"] })), message: /value 2 is not a finite number/ },
    { text: JSON.stringify(spec({ values: [1, 1e999] })), message: /value 2 is not a finite number/ },
    { text: JSON.stringify(spec({ values: [] , labels: [] })), message: /at least one point/ },
    { text: JSON.stringify(spec({ labels: ["ma"] })), message: /differ in length \(1 labels, 2 values\)/ },
    { text: JSON.stringify(spec({ values: [1, 2, 3] })), message: /differ in length/ },
  ];
  for (const item of cases) {
    const parsed = parseChartSpec(item.text);
    assert.equal(parsed.ok, false, `expected a refusal for ${item.text}`);
    if (parsed.ok) continue;
    assert.match(parsed.error, item.message);
  }
});

test("the markdown summary is a table plus totals, byte for byte", () => {
  const parsed = parseChartSpec(JSON.stringify(VALID));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const markdown = chartMarkdown(parsed.spec);
  const again = chartMarkdown({ ...parsed.spec, labels: [...parsed.spec.labels], values: [...parsed.spec.values] });
  assert.equal(markdown, again);
  assert.equal(
    markdown,
    [
      "### Bezoek",
      "",
      "| label | value |",
      "| --- | --- |",
      "| ma | 3 |",
      "| di | 7 |",
      "",
      "2 points · total 10 · min 3 (ma) · max 7 (di)",
    ].join("\n"),
  );
});

test("a pipe in a label cannot break the table", () => {
  const parsed = parseChartSpec(JSON.stringify({ type: "bar", labels: ["a|b", "c"], values: [1.5, 2] }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const markdown = chartMarkdown(parsed.spec);
  assert.match(markdown, /^\| a\\\|b \| 1\.5 \|$/mu);
  assert.match(markdown, /^2 points · total 3\.5 · min 1\.5 \(a\|b\) · max 2 \(c\)$/mu);
  assert.equal(formatNumber(1.5), "1.5");
  assert.equal(formatNumber(2), "2");
  assert.equal(formatNumber(-0.25), "-0.25");
});

test("CSV with commas parses, quotes and all", () => {
  const table = readTabular('naam,stad,bezoek\n"Zwolle, NL",Zwolle,3\nAne,"Den Haag",7\n');
  assert.deepEqual([...table.columns], ["naam", "stad", "bezoek"]);
  assert.deepEqual(
    table.rows.map((row) => [...row]),
    [
      ["Zwolle, NL", "Zwolle", "3"],
      ["Ane", "Den Haag", "7"],
    ],
  );
  assert.equal(table.truncated, false);
});

test("CSV with semicolons is sniffed from the header, not the name", () => {
  const table = readTabular(Buffer.from("naam;stad\nAne;Zwolle\n"));
  assert.deepEqual([...table.columns], ["naam", "stad"]);
  assert.deepEqual([...table.rows[0] ?? []], ["Ane", "Zwolle"]);
});

test("quoted newlines and doubled quotes stay inside one cell", () => {
  const table = readTabular('kop,tekst\n1,"regel een\nregel twee"\n2,"hij zei ""hoi"""\n');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]?.[1], "regel een\nregel twee");
  assert.equal(table.rows[1]?.[1], 'hij zei "hoi"');
});

test("TSV wins over a comma hiding inside a quoted cell", () => {
  const table = readTabular('naam\tnotitie\nAne\t"Zwolle, NL"\n');
  assert.deepEqual([...table.columns], ["naam", "notitie"]);
  assert.deepEqual([...table.rows[0] ?? []], ["Ane", "Zwolle, NL"]);
});

test("a JSON array of objects becomes columns in first-seen order", () => {
  const table = readTabular(
    JSON.stringify([
      { naam: "Ane", bezoek: 3 },
      { bezoek: 7, naam: "Bo", extra: null },
      { naam: "Cis", bezoek: 1, vlag: true },
    ]),
  );
  assert.deepEqual([...table.columns], ["naam", "bezoek", "extra", "vlag"]);
  assert.deepEqual(
    table.rows.map((row) => [...row]),
    [
      ["Ane", "3", "", ""],
      ["Bo", "7", "", ""],
      ["Cis", "1", "", "true"],
    ],
  );
});

test("ragged rows are padded and cut to the header, never dropped", () => {
  const table = readTabular("a,b,c\n1\n1,2,3,4\n");
  assert.equal(table.rows.length, 2);
  assert.deepEqual([...table.rows[0] ?? []], ["1", "", ""]);
  assert.deepEqual([...table.rows[1] ?? []], ["1", "2", "3"]);
});

test("a blank header cell gets a readable name", () => {
  const table = readTabular(",waarde\nx,1\n");
  assert.deepEqual([...table.columns], ["column 1", "waarde"]);
});

test("the row cap truncates and says so", () => {
  const lines = ["a,b"];
  for (let index = 0; index < 5; index += 1) lines.push(`${String(index)},${String(index * 2)}`);
  const table = readTabular(lines.join("\n"), 3);
  assert.equal(table.rows.length, 3);
  assert.equal(table.truncated, true);
  assert.equal(readTabular(lines.join("\n"), MAX_TABLE_ROWS).truncated, false);
});

test("tabular input that is not tabular is refused with a sentence", () => {
  assert.throws(() => readTabular("   "), /file is empty/);
  assert.throws(() => readTabular("[{\"a\":1},"), /not valid JSON/);
  assert.throws(() => readTabular("[1,2]"), /every JSON array entry must be an object/);
  assert.throws(() => readTabular("[]"), /JSON array is empty/);
  assert.throws(() => readTabular("a,b\n", 0), /maxRows must be at least 1/);
});
