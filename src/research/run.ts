/**
 * A bounded deep-research loop: plan, search, read, cite, report.
 *
 * The loop is deliberately small and deliberately capped. Four searches, eight
 * pages, sixty seconds — after that the run stops and says so, because a
 * research mode that quietly wanders is worse than one that reports less. Every
 * boundary is injectable: the three side effects (`search`, `extract`, `model`)
 * arrive as plain functions and the clock arrives through `limits.now`, so the
 * whole loop is testable without a provider, a socket, a network or a sleep.
 *
 * Citations are earned, not claimed. A source enters the report only after its
 * page was fetched and its text came back non-empty; the report renderer then
 * strips any `[n]` the model invented. The result says why it stopped and what
 * it could not find, in `stopReason` and `notes`.
 */

import type { SearchHit } from "../web/types.js";
import { DEFAULT_SUB_QUERIES, planSubQueries } from "./plan.js";
import { buildReport, type ResearchReport, type ResearchSource } from "./report.js";

/** The hard fan-out ceiling; `limits.maxSubQueries` may only lower it. */
export const MAX_SUB_QUERIES = DEFAULT_SUB_QUERIES;

/** The hard page ceiling; every attempted fetch counts, failed ones included. */
export const MAX_EXTRACTS = 8;

/** The hard wall-clock ceiling for the whole run, planning included. */
export const MAX_MILLISECONDS = 60_000;

/** How many https results per query are worth reading. */
export const RESULTS_PER_QUERY = 2;

/** How much of one page reaches the report prompt, in bytes. */
export const MAX_EXTRACT_BYTES = 20_000;

/** Search one query. The real implementation wraps the web plugin. */
export type ResearchSearch = (query: string) => Promise<readonly SearchHit[]>;

/** Fetch one https page as plain text. */
export type ResearchExtract = (url: string) => Promise<string>;

/** The injected model: planning and report-writing share one call shape. */
export type ResearchModel = (prompt: string) => Promise<string>;

/** Everything the loop needs from the outside world. */
export interface ResearchDeps {
  readonly search: ResearchSearch;
  readonly extract: ResearchExtract;
  readonly model: ResearchModel;
}

/** Caps and the clock. Each value may lower a hard ceiling, never raise it. */
export interface ResearchLimits {
  readonly maxSubQueries?: number;
  readonly maxExtracts?: number;
  readonly maxMilliseconds?: number;
  readonly resultsPerQuery?: number;
  readonly maxExtractBytes?: number;
  /** Injected clock in epoch milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Why the loop stopped, in the run's own words. */
export type ResearchStopReason =
  | "complete"
  | "no-sources"
  | "no-queries"
  | "extract-limit"
  | "time-limit";

/** Everything a finished run produced, including the honest parts. */
export interface ResearchResult {
  readonly question: string;
  readonly queries: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly report: ResearchReport;
  readonly stopReason: ResearchStopReason;
  readonly notes: readonly string[];
  readonly elapsedMs: number;
}

/** Resolved caps: hard ceilings applied, defaults filled in. */
interface ResolvedLimits {
  readonly maxSubQueries: number;
  readonly maxExtracts: number;
  readonly maxMilliseconds: number;
  readonly resultsPerQuery: number;
  readonly maxExtractBytes: number;
  readonly now: () => number;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Fill in defaults and clamp every cap to the feature's hard ceiling. */
export function resolveLimits(limits: ResearchLimits = {}): ResolvedLimits {
  return {
    maxSubQueries: clampInt(limits.maxSubQueries, MAX_SUB_QUERIES, 0, MAX_SUB_QUERIES),
    maxExtracts: clampInt(limits.maxExtracts, MAX_EXTRACTS, 0, MAX_EXTRACTS),
    maxMilliseconds: clampInt(limits.maxMilliseconds, MAX_MILLISECONDS, 0, MAX_MILLISECONDS),
    resultsPerQuery: clampInt(limits.resultsPerQuery, RESULTS_PER_QUERY, 1, RESULTS_PER_QUERY),
    maxExtractBytes: clampInt(limits.maxExtractBytes, MAX_EXTRACT_BYTES, 1, 1_000_000),
    now: limits.now ?? Date.now,
  };
}

/**
 * A usable result url: absolute https, no fragment. Anything else is skipped —
 * the web layer is an https lane and a citation must point at the page read.
 */
function httpsUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  parsed.hash = "";
  return parsed.toString();
}

/** The dedupe key: one trailing slash does not make a second page. */
function urlKey(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Cap page text by bytes without splitting a UTF-8 sequence.
 *
 * A byte cap matters because a page can be megabytes of HTML-turned-text; a
 * character cap would let one Dutch page cost twice what an English one costs.
 */
export function capBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

/** `60000` → `60 s`, `1500` → `1.5 s`; used in the honest stop notes. */
function formatDuration(ms: number): string {
  if (ms % 1000 === 0) return `${String(ms / 1000)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** How much of a source reaches the report prompt. */
const EXCERPT_CHARS = 1200;

/** The prompt that turns fetched pages into prose with inline citations. */
export function buildReportPrompt(
  question: string,
  sources: readonly ResearchSource[],
  excerpts: ReadonlyMap<number, string>,
): string {
  const blocks = sources.map((source) => {
    const excerpt = (excerpts.get(source.index) ?? "").replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
    const lines = [`[${String(source.index)}] ${source.title}`, `url: ${source.url}`];
    const snippet = source.snippet.replace(/\s+/g, " ").trim();
    if (snippet.length > 0) lines.push(`snippet: ${snippet}`);
    if (excerpt.length > 0) lines.push(`excerpt: ${excerpt}`);
    return lines.join("\n");
  });

  return [
    "You write a short research report for a personal agent. Use only the",
    "sources below. Cite every factual claim with the source's number in square",
    "brackets, like [1]; a sentence drawing on two sources can say [1][2].",
    "Never cite a number that is not listed. If the sources do not answer the",
    "question, say what is missing instead of guessing. Answer in the language",
    "of the question, in markdown, in at most 400 words, and do not add a",
    "sources section — the app adds one.",
    "",
    "Question:",
    question.replace(/\s+/g, " ").trim(),
    "",
    "Sources:",
    blocks.join("\n\n"),
  ].join("\n");
}

/** A body used when the model wrote nothing: honest, and never invented. */
const NO_SYNTHESIS =
  "The report text could not be generated. The fetched sources are listed below.";

/** A body used when no page could be fetched at all. */
const NOTHING_FOUND =
  "Nothing found: no search result could be fetched, so there is nothing to cite.";

/**
 * Run the bounded loop.
 *
 * Planning failure falls back to the question itself; a failed search or page
 * is a note, not the end of the run; an exhausted budget stops the loop with a
 * `stopReason` and a note that names the limit. The report is always rendered,
 * even when it can only say that nothing was found.
 */
export async function runResearch(
  question: string,
  deps: ResearchDeps,
  limits: ResearchLimits = {},
): Promise<ResearchResult> {
  const asked = question.replace(/\s+/g, " ").trim();
  if (asked.length === 0) throw new Error("research question is empty");

  const caps = resolveLimits(limits);
  const startedAt = caps.now();
  const elapsed = (): number => Math.max(0, caps.now() - startedAt);
  const notes: string[] = [];

  let queries: string[];
  try {
    queries = await planSubQueries(asked, { model: deps.model }, caps.maxSubQueries);
  } catch (error) {
    queries = [asked];
    notes.push(
      `planning failed (${error instanceof Error ? error.message : String(error)}); ` +
        "searched the question itself",
    );
  }

  if (queries.length === 0) {
    notes.push("no searches were planned");
    const report = buildReport({
      question: asked,
      body: NOTHING_FOUND,
      sources: [],
      notes,
    });
    return {
      question: asked,
      queries: [],
      sources: [],
      report,
      stopReason: "no-queries",
      notes,
      elapsedMs: elapsed(),
    };
  }

  const sources: ResearchSource[] = [];
  const excerpts = new Map<number, string>();
  const seen = new Set<string>();
  let extractsStarted = 0;
  let queriesStarted = 0;
  let stop: ResearchStopReason | null = null;
  if (elapsed() >= caps.maxMilliseconds) {
    stop = "time-limit";
    notes.push(
      `the ${formatDuration(caps.maxMilliseconds)} wall-clock limit was reached while planning; ` +
        "no page was searched",
    );
  }

  searchLoop: for (const query of queries) {
    if (stop !== null) break;
    if (elapsed() >= caps.maxMilliseconds) {
      stop = "time-limit";
      break;
    }
    queriesStarted += 1;

    let hits: readonly SearchHit[];
    try {
      hits = await deps.search(query);
    } catch (error) {
      notes.push(
        `search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const usable: { url: string; hit: SearchHit }[] = [];
    for (const hit of hits) {
      const url = httpsUrl(hit.url);
      if (url === null) continue;
      usable.push({ url, hit });
      if (usable.length === caps.resultsPerQuery) break;
    }
    if (usable.length === 0) {
      notes.push(`no usable https results for "${query}"`);
      continue;
    }

    for (const { url, hit } of usable) {
      if (extractsStarted >= caps.maxExtracts) {
        stop = "extract-limit";
        break searchLoop;
      }
      if (elapsed() >= caps.maxMilliseconds) {
        stop = "time-limit";
        break searchLoop;
      }

      const key = urlKey(url);
      if (seen.has(key)) continue;
      seen.add(key);

      // The budget counts attempts, not successes: a site that always fails
      // must not be retried until the clock runs out.
      extractsStarted += 1;

      let text: string;
      try {
        text = await deps.extract(url);
      } catch (error) {
        notes.push(
          `could not read ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (elapsed() >= caps.maxMilliseconds) stop = "time-limit";
        if (stop !== null) break searchLoop;
        continue;
      }

      const page = text.trim();
      if (page.length === 0) {
        notes.push(`empty page: ${url}`);
        if (elapsed() >= caps.maxMilliseconds) stop = "time-limit";
        if (stop !== null) break searchLoop;
        continue;
      }

      const capped = capBytes(page, caps.maxExtractBytes);
      const index = sources.length + 1;
      sources.push({
        index,
        title: hit.title.trim() || url,
        url,
        snippet: hit.snippet.replace(/\s+/g, " ").trim(),
        bytes: Buffer.byteLength(capped, "utf8"),
      });
      excerpts.set(index, capped);

      if (elapsed() >= caps.maxMilliseconds) {
        stop = "time-limit";
        break searchLoop;
      }
    }
  }

  if (sources.length === 0) {
    if (stop === null) stop = "no-sources";
    notes.push(
      `nothing was fetched from ${String(queriesStarted)} of ${String(queries.length)} queries`,
    );
  } else if (stop === null) {
    stop = "complete";
  }

  if (stop === "time-limit") {
    notes.push(
      `stopped at the ${formatDuration(caps.maxMilliseconds)} wall-clock limit after ` +
        `${String(queriesStarted)} of ${String(queries.length)} queries and ` +
        `${String(extractsStarted)} of ${String(caps.maxExtracts)} pages; ` +
        "the report may be incomplete",
    );
  }
  if (stop === "extract-limit") {
    notes.push(
      `stopped at the ${String(caps.maxExtracts)}-page extract limit after ` +
        `${String(queriesStarted)} of ${String(queries.length)} queries; ` +
        "the report may be incomplete",
    );
  }

  let body = NOTHING_FOUND;
  if (sources.length > 0) {
    body = NO_SYNTHESIS;
    if (elapsed() >= caps.maxMilliseconds) {
      notes.push("the wall-clock limit was reached before the report model ran");
    } else {
      try {
        const written = await deps.model(buildReportPrompt(asked, sources, excerpts));
        if (written.trim().length > 0) {
          body = written;
        } else {
          notes.push("the report model returned no text");
        }
      } catch (error) {
        notes.push(
          `the report model failed (${error instanceof Error ? error.message : String(error)}); ` +
            "the fetched sources are listed without synthesis",
        );
      }
    }
  }

  const report = buildReport({ question: asked, body, sources, notes });

  return {
    question: asked,
    queries,
    sources,
    report,
    stopReason: stop,
    notes,
    elapsedMs: elapsed(),
  };
}
