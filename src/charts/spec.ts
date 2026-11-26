import { isTextMime } from "../workspace/library.js";

/**
 * Turning a table into something a person can read and draw.
 *
 * The input is deliberately a small JSON dialect: a chart is a title, a list of
 * labels and a list of numbers. Nothing here evaluates code, fetches anything or
 * guesses — a spec that does not add up is refused with a sentence, because a
 * chart drawn from mismatched arrays is a lie with axes.
 *
 * `chartMarkdown` exists so the same numbers can land in a message or report
 * without a renderer: one table, deterministic to the byte.
 */

export const CHART_TYPES = ["line", "bar", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** More points than this stop being a chart and start being a data dump. */
export const MAX_CHART_POINTS = 50;
/** Rows `readTabular` keeps by default. */
export const MAX_TABLE_ROWS = 500;

export interface ChartSpec {
  readonly type: ChartType;
  readonly title: string;
  readonly labels: readonly string[];
  readonly values: readonly number[];
}

export type ChartParse = { readonly ok: true; readonly spec: ChartSpec } | { readonly ok: false; readonly error: string };

function fail(error: string): ChartParse {
  return { ok: false, error };
}

function isChartType(value: unknown): value is ChartType {
  return value === "line" || value === "bar" || value === "pie";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A chart spec from text, or the first thing wrong with it.
 *
 * The checks are the ones that matter for honesty: types, equal lengths, finite
 * values, and a cap. An empty label is allowed (a bar can be unlabelled); an
 * empty values array is not.
 */
export function parseChartSpec(text: string): ChartParse {
  if (typeof text !== "string" || text.trim().length === 0) return fail("chart spec: nothing to read");

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(`chart spec: not valid JSON (${detail})`);
  }

  if (!isRecord(raw)) return fail("chart spec: expected an object with type, labels and values");

  const type = raw["type"];
  if (!isChartType(type)) return fail('chart spec: type must be one of "line", "bar" or "pie"');

  const title = raw["title"];
  if (title !== undefined && typeof title !== "string") return fail("chart spec: title must be a string");

  const labels = raw["labels"];
  if (!Array.isArray(labels)) return fail("chart spec: labels must be an array of strings");
  if (!labels.every((label): label is string => typeof label === "string")) {
    return fail("chart spec: labels must be an array of strings");
  }

  const values = raw["values"];
  if (!Array.isArray(values)) return fail("chart spec: values must be an array of numbers");

  if (labels.length !== values.length) {
    return fail(
      `chart spec: labels and values differ in length (${String(labels.length)} labels, ${String(values.length)} values)`,
    );
  }
  if (values.length === 0) return fail("chart spec: needs at least one point");
  if (values.length > MAX_CHART_POINTS) {
    return fail(`chart spec: at most ${String(MAX_CHART_POINTS)} points, got ${String(values.length)}`);
  }
  for (const [index, value] of values.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(`chart spec: value ${String(index + 1)} is not a finite number`);
    }
  }

  return {
    ok: true,
    spec: {
      type,
      title: typeof title === "string" ? title.trim() : "",
      labels: [...labels],
      values: [...values],
    },
  };
}

/** A number as a short, stable string: no locale, no exponent surprises. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/u, "");
}

/** A label safe inside a Markdown table cell. */
function cell(label: string): string {
  return label.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

/**
 * The spec as Markdown: a heading, the summary table, one line of totals.
 *
 * No sorting and no rounding beyond two decimals, so the same spec renders the
 * same bytes on every machine — a report that changes between runs is a report
 * nobody can diff.
 */
export function chartMarkdown(spec: ChartSpec): string {
  const heading = spec.title.length > 0 ? spec.title : "Chart";
  const lines: string[] = [`### ${heading}`, "", "| label | value |", "| --- | --- |"];
  for (const [index, value] of spec.values.entries()) {
    lines.push(`| ${cell(spec.labels[index] ?? "")} | ${formatNumber(value)} |`);
  }

  let total = 0;
  let minIndex = 0;
  let maxIndex = 0;
  for (const [index, value] of spec.values.entries()) {
    total += value;
    if (value < (spec.values[minIndex] ?? value)) minIndex = index;
    if (value > (spec.values[maxIndex] ?? value)) maxIndex = index;
  }
  const count = spec.values.length;
  const summary =
    `${String(count)} ${count === 1 ? "point" : "points"} · ` +
    `total ${formatNumber(total)} · ` +
    `min ${formatNumber(spec.values[minIndex] ?? 0)} (${spec.labels[minIndex] ?? ""}) · ` +
    `max ${formatNumber(spec.values[maxIndex] ?? 0)} (${spec.labels[maxIndex] ?? ""})`;
  lines.push("", summary);
  return lines.join("\n");
}

export interface Table {
  /** Header cells, in file order; blank names become `column N`. */
  readonly columns: readonly string[];
  /** Rows as strings, one cell per column; short rows are padded, long ones cut. */
  readonly rows: readonly (readonly string[])[];
  /** True when the input held more rows than the cap allowed. */
  readonly truncated: boolean;
}

function decode(input: Buffer | Uint8Array | string): string {
  const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  return text.replace(/^\uFEFF/u, "");
}

/** Count each candidate delimiter outside quotes on the header line: it decides. */
function sniffDelimiter(text: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === "\n" || character === "\r")) break;
    else if (!quoted && (character === "," || character === ";" || character === "\t")) {
      counts[character as "," | ";" | "\t"] += 1;
    }
  }
  if (counts["\t"] > counts[","] && counts["\t"] >= counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/**
 * CSV/TSV rows, quoted fields and all.
 *
 * A real parser, not a `split(",")`: a value like `"Zwolle, NL"` is one cell in
 * a comma file, and `""` inside quotes is a literal quote. Rows end at a bare
 * newline; a newline inside quotes stays inside the cell.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (character === "\r") {
      index += text[index + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }
    if (character === "\n") {
      index += 1;
      endRow();
      continue;
    }
    field += character;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

function isBlankRow(row: readonly string[]): boolean {
  return row.length === 1 && (row[0] ?? "").trim().length === 0;
}

function cellFrom(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function trim(rows: readonly (readonly string[])[], columns: readonly string[]): string[][] {
  return rows.map((row) => {
    const out: string[] = [];
    for (let index = 0; index < columns.length; index += 1) out.push(row[index] ?? "");
    return out;
  });
}

/**
 * A table from CSV, TSV or a JSON array of objects.
 *
 * The format is sniffed from the text, never from the file name: bytes are what
 * arrived, and a `.csv` that holds JSON is still JSON. Ragged rows are padded
 * rather than dropped — a missing cell is a gap a person should see, not a row
 * that silently disappears.
 */
export function readTabular(input: Buffer | Uint8Array | string, maxRows: number = MAX_TABLE_ROWS): Table {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("readTabular: maxRows must be at least 1");
  const text = decode(input);
  if (text.trim().length === 0) throw new Error("readTabular: the file is empty");

  const first = text.trimStart()[0] ?? "";
  if (first === "[") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`readTabular: not valid JSON (${detail})`);
    }
    if (!Array.isArray(parsed)) throw new Error("readTabular: expected a JSON array of objects");
    if (parsed.length === 0) throw new Error("readTabular: the JSON array is empty");

    const columns: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!isRecord(item)) throw new Error("readTabular: every JSON array entry must be an object");
      for (const key of Object.keys(item)) {
        if (seen.has(key)) continue;
        seen.add(key);
        columns.push(key);
      }
    }
    const objects = parsed as readonly Record<string, unknown>[];
    const kept = objects.slice(0, maxRows);
    return {
      columns,
      rows: kept.map((item) => columns.map((key) => cellFrom(item[key]))),
      truncated: objects.length > maxRows,
    };
  }

  const delimiter = sniffDelimiter(text);
  const rows = parseDelimited(text, delimiter).filter((row) => !isBlankRow(row));
  const header = rows[0];
  if (header === undefined) throw new Error("readTabular: no header row");
  const columns = header.map((name, index) => {
    const clean = name.trim();
    return clean.length > 0 ? clean : `column ${String(index + 1)}`;
  });
  const body = rows.slice(1);
  const kept = body.slice(0, maxRows);
  return { columns, rows: trim(kept, columns), truncated: body.length > maxRows };
}

/** The text types `readTabular` is willing to look at. */
export function isTabularText(mime: string): boolean {
  return isTextMime(mime);
}
