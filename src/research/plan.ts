/**
 * Turning one question into a handful of searches.
 *
 * A deep-research run is only as good as its queries: one broad query returns
 * the popular page, while three narrow ones return the page that answers the
 * question. The model proposes them, but its answer is untrusted input like any
 * other — it may be a JSON array, a fenced block, an object wrapping an array,
 * or a bullet list. The parser accepts all of those, drops duplicates on the
 * normalised text, and never returns more than the caller allowed.
 *
 * The model call is injected as a plain function, so planning is testable
 * without a provider, a socket or a network. When the answer holds nothing
 * usable the question itself is the fallback: one honest search beats no
 * research at all, and the fallback is visible in the return value.
 */

/** How many searches one run asks for unless the caller says otherwise. */
export const DEFAULT_SUB_QUERIES = 4;

/** The hard ceiling; no caller can plan a larger fan-out than this. */
export const MAX_SUB_QUERIES = 4;

/** Longer questions are cut here before they reach the prompt. */
const MAX_QUESTION_CHARS = 2000;

/** The injected model call: one prompt in, one answer out. */
export type PlanModel = (prompt: string) => Promise<string>;

/** What planning needs; a subset of the research dependencies. */
export interface PlanDeps {
  readonly model: PlanModel;
}

/** The comparison key for a query: case and whitespace do not make a difference. */
export function normaliseQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Strip list markers, wrapping quotes, bold markers and a leading
 * `Query:`-style label, then collapse inner whitespace.
 */
function cleanQuery(value: string): string {
  let text = value
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/^\s*(?:query|search|q)\s*[:=-]\s*/i, "")
    .trim();

  // A model that wraps the whole query in bold, quotes or backticks is still
  // saying the same thing; the wrappers are formatting, not part of the query.
  const bold = /^\*\*(.+)\*\*$/.exec(text);
  if (bold?.[1] !== undefined) text = bold[1].trim();

  const wrapped =
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"));
  if (wrapped && text.length >= 2) text = text.slice(1, -1).trim();

  return text.replace(/\s+/g, " ").trim();
}

/** A JSON value that may be a string or an object carrying a `query`. */
function stringItems(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const query = (item as { query?: unknown }).query;
      if (typeof query === "string") out.push(query);
    }
  }
  return out;
}

/** Try `text` as JSON, and as the smallest JSON array inside it, in that order. */
function fromJson(text: string): string[] | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const attempts = [unfenced];
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start !== -1 && end > start) attempts.push(unfenced.slice(start, end + 1));

  for (const attempt of attempts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt);
    } catch {
      continue;
    }
    const direct = stringItems(parsed);
    if (direct !== null) return direct;

    // Some models answer `{ "queries": [...] }`; look one level down for the
    // first array of strings rather than guessing a key name.
    if (typeof parsed === "object" && parsed !== null) {
      for (const value of Object.values(parsed)) {
        const nested = stringItems(value);
        if (nested !== null && nested.length > 0) return nested;
      }
    }
  }
  return null;
}

/** Lines that start with a bullet or a number followed by a bracket/full stop. */
function fromBullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/.exec(line);
    if (match?.[1] !== undefined) out.push(match[1]);
  }
  return out;
}

/** Clamp a requested fan-out into `0..MAX_SUB_QUERIES`. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_SUB_QUERIES;
  return Math.max(0, Math.min(MAX_SUB_QUERIES, Math.trunc(limit)));
}

/**
 * Read whatever the model answered as a list of search queries.
 *
 * A JSON array of strings wins; an object wrapping such an array and a bullet
 * list are accepted too. Empties, non-strings and duplicates (on the normalised
 * text) are dropped, and the list is capped at `limit`.
 */
export function parseSubQueries(answer: string, limit: number = DEFAULT_SUB_QUERIES): string[] {
  const cap = clampLimit(limit);
  if (cap === 0) return [];
  const raw = fromJson(answer) ?? fromBullets(answer);
  const queries: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    const query = cleanQuery(value);
    const key = normaliseQuery(query);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length === cap) break;
  }

  return queries;
}

/** The prompt handed to the planner. Kept beside the parser so they stay in step. */
export function buildPlanPrompt(question: string, limit: number): string {
  const asked = clampLimit(limit);
  return [
    "You plan web research for a personal agent. Break the question below",
    `into at most ${String(asked)} short search queries that together cover it.`,
    "Each query is concrete, in the language of the question, and narrow enough",
    "to return relevant pages. Do not answer the question and do not add",
    "commentary. If one query is enough, answer with one.",
    "",
    "Question:",
    question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS),
    "",
    `Answer with a JSON array of at most ${String(asked)} strings and nothing else.`,
  ].join("\n");
}

/** A fan-out of zero (or a model that failed) still has the question to fall back on. */
function fallbackQueries(question: string): string[] {
  const trimmed = question.replace(/\s+/g, " ").trim();
  return trimmed.length === 0 ? [] : [trimmed];
}

/**
 * Decompose `question` into at most `limit` search queries.
 *
 * The model proposes; this function decides. An answer with no usable list —
 * or a model call that throws — falls back to the question itself, so research
 * can always start. An empty question is rejected before the model is called:
 * there is nothing to decompose and no honest query to invent.
 */
export async function planSubQueries(
  question: string,
  deps: PlanDeps,
  limit: number = DEFAULT_SUB_QUERIES,
): Promise<string[]> {
  if (typeof question !== "string" || question.trim().length === 0) {
    throw new Error("research question is empty");
  }
  const cap = clampLimit(limit);
  if (cap === 0) return [];

  const answer = await deps.model(buildPlanPrompt(question, cap));
  const parsed = parseSubQueries(answer, cap);
  return parsed.length > 0 ? parsed : fallbackQueries(question);
}
