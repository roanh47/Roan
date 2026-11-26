/**
 * The artifact a research run leaves behind: a markdown report and the map
 * that turns every `[n]` in it into a url that was actually fetched.
 *
 * The model writes prose, not truth. Its `[n]` markers are therefore treated
 * as untrusted input: a marker is kept only when `n` belongs to a fetched
 * source, and every other marker is removed and reported as rejected. That is
 * the whole guarantee — the report can say something wrong, but it can never
 * point at a page the run did not read, and the Sources list can never grow a
 * row the run did not earn.
 */

import type { SearchHit } from "../web/types.js";

/** One page that was fetched successfully, numbered for citation. */
export interface ResearchSource extends SearchHit {
  /** 1-based number matching `[n]` in the report body. */
  readonly index: number;
  /** Bytes of the capped page text that was actually read. */
  readonly bytes: number;
}

/** What the caller hands the renderer. */
export interface ReportInput {
  readonly question: string;
  /** The model's prose, with inline `[n]` citations. */
  readonly body: string;
  /** Only pages the run fetched; nothing else may appear in Sources. */
  readonly sources: readonly ResearchSource[];
  /** Honest remarks about limits, failures and missing results. */
  readonly notes?: readonly string[];
}

/** The finished report plus the citation map the UI can act on. */
export interface ResearchReport {
  readonly markdown: string;
  /** `n` → url, for every citation that survives in the body. */
  readonly citationIndex: ReadonlyMap<number, string>;
  /** Marker numbers the model invented; stripped from `markdown`. */
  readonly rejectedCitations: readonly number[];
}

/** `[1]`, `[12]` and `[1, 3]` are the shapes models actually write. */
const MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** The citation map for a set of fetched sources; first writer wins. */
export function citationIndex(sources: readonly ResearchSource[]): ReadonlyMap<number, string> {
  const index = new Map<number, string>();
  for (const source of sources) {
    if (!index.has(source.index)) index.set(source.index, source.url);
  }
  return index;
}

/** The result of removing markers no fetched source backs. */
export interface SanitisedBody {
  readonly text: string;
  readonly rejected: readonly number[];
}

/**
 * Keep only markers whose number is in `valid`, dropping the others.
 *
 * A group like `[1, 9]` keeps its real half and loses the invented one; a group
 * where nothing is valid disappears. Repeated rejections are reported once.
 */
export function sanitiseCitations(body: string, valid: ReadonlySet<number>): SanitisedBody {
  const rejected: number[] = [];
  const text = body
    .replace(MARKER, (_match: string, group: string) => {
      const kept: number[] = [];
      for (const part of group.split(",")) {
        const value = Number.parseInt(part.trim(), 10);
        if (!Number.isFinite(value)) continue;
        if (valid.has(value)) {
          if (!kept.includes(value)) kept.push(value);
        } else if (!rejected.includes(value)) {
          rejected.push(value);
        }
      }
      return kept.length > 0 ? `[${kept.join(", ")}]` : "";
    })
    // Removing a marker can leave " ." or a double space; tidy only that much.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();

  return { text, rejected };
}

/** Markdown link text must not close the link early. */
function linkText(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim() || "Untitled";
  return clean.replace(/[[\]]/g, (bracket) => `\\${bracket}`);
}

/** The Sources section: one numbered entry per fetched page. */
function renderSources(sources: readonly ResearchSource[]): string[] {
  if (sources.length === 0) return ["_No sources were fetched._"];

  const lines: string[] = [];
  for (const source of sources) {
    lines.push(`${String(source.index)}. [${linkText(source.title)}](${source.url})`);
    const snippet = source.snippet.replace(/\s+/g, " ").trim();
    if (snippet.length > 0) lines.push(`   ${snippet}`);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Render the artifact.
 *
 * The body is sanitised against the fetched sources before it is written, so
 * the returned markdown never mentions a citation number outside the index.
 * An empty body becomes an explicit line rather than a blank section, and a
 * report without notes simply omits that section.
 */
export function buildReport(input: ReportInput): ResearchReport {
  const question = input.question.replace(/\s+/g, " ").trim();
  const index = citationIndex(input.sources);
  const { text, rejected } = sanitiseCitations(input.body.trim(), new Set(index.keys()));

  const lines: string[] = [`# ${question.length > 0 ? question : "Research report"}`, ""];
  lines.push(text.length > 0 ? text : "_Nothing was written._");
  lines.push("");

  const notes = (input.notes ?? []).map((note) => note.trim()).filter((note) => note.length > 0);
  if (notes.length > 0) {
    lines.push("## Notes", "");
    for (const note of notes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## Sources", "");
  lines.push(...renderSources(input.sources));
  lines.push("");

  return {
    markdown: lines.join("\n"),
    citationIndex: index,
    rejectedCitations: rejected,
  };
}
