/**
 * Reading a skill proposal out of whatever a model answered.
 *
 * The answer is untrusted input like any other. It may be the JSON object the
 * prompt asked for, a whole `SKILL.md` with frontmatter, a `# Heading` and some
 * steps, a refusal, a paragraph of prose, or nothing at all. Parsing is
 * deliberately forgiving about shape and strict about substance: a proposal
 * needs a directory-safe name and a non-empty, not-absurdly-long body, and
 * anything short of that is `null` rather than a half-skill.
 *
 * `NAME` normalisation lives here too, because the name becomes a directory
 * under `skills/`: every character that is not a letter or a digit becomes a
 * hyphen, which rules out `/`, `\`, `.` and `..` by construction rather than by
 * a check someone has to remember to keep.
 */

import { parseFrontmatter } from "../context/frontmatter.js";

/** A skill body longer than this is not a skill, it is a document. */
export const MAX_BODY_CHARS = 20000;

/** One line, kept short enough to sit in the prompt index. */
export const MAX_DESCRIPTION_CHARS = 160;

const MIN_NAME_CHARS = 3;
const MAX_NAME_CHARS = 48;

/** What a draft is: enough to render a `SKILL.md`, and no more. */
export interface SkillDraft {
  /** Slug, lower-case with hyphens; the directory name under `skills/`. */
  readonly name: string;
  /** One line for the prompt index. */
  readonly description: string;
  /** The instructions, without frontmatter. */
  readonly body: string;
}

/**
 * A directory-safe slug for `raw`, or `null` when nothing usable is left.
 *
 * Names come from a model, so they arrive as "Docker Compose Tips!", "docker
 * compose", or a path.
 */
export function normaliseSkillName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_CHARS)
    .replace(/-+$/g, "");
  if (slug.length < MIN_NAME_CHARS) return null;
  return slug;
}

/** Strip a fence that wraps the whole answer; leave an inner fence alone. */
function unfence(text: string): string {
  const wrapped = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/.exec(text);
  return wrapped?.[1] !== undefined ? wrapped[1].trim() : text;
}

/** The first line that says something, with heading marks and spacing removed. */
export function deriveDescription(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const clean = line
      .replace(/^#+\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length === 0) continue;
    return clean.slice(0, MAX_DESCRIPTION_CHARS);
  }
  return "";
}

/**
 * Build a draft from loose parts, or `null` when they cannot make a skill.
 *
 * A body that is only frontmatter is not a skill; neither is one longer than
 * `MAX_BODY_CHARS`. `description` comes from the caller, then from the body's
 * own frontmatter, then from its first line.
 */
function buildDraft(
  nameRaw: unknown,
  bodyRaw: unknown,
  descriptionRaw: unknown,
): SkillDraft | null {
  const name = normaliseSkillName(nameRaw);
  if (name === null || typeof bodyRaw !== "string") return null;

  const parsed = parseFrontmatter(bodyRaw);
  const body = parsed.body.trim();
  if (body.length === 0 || body.length > MAX_BODY_CHARS) return null;

  const given = typeof descriptionRaw === "string" ? descriptionRaw.replace(/\s+/g, " ").trim() : "";
  const described = given.length > 0 ? given : (parsed.description ?? "").trim();
  const description = (described.length > 0 ? described : deriveDescription(body)).slice(
    0,
    MAX_DESCRIPTION_CHARS,
  );

  return { name, description, body };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A JSON object with `name` and `body`, optionally `description`. */
function fromJson(text: string): SkillDraft | null {
  const unfenced = unfence(text);
  const attempts = [unfenced];
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start !== -1 && end > start) attempts.push(unfenced.slice(start, end + 1));

  for (const attempt of attempts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (record === null) continue;
    const draft = buildDraft(record["name"], record["body"], record["description"]);
    if (draft !== null) return draft;
  }
  return null;
}

/** A whole `SKILL.md`: frontmatter, or a `# Heading` naming it. */
function fromMarkdown(text: string): SkillDraft | null {
  const unfenced = unfence(text);
  const parsed = parseFrontmatter(unfenced);

  if (parsed.name !== undefined || parsed.description !== undefined) {
    return buildDraft(parsed.name, parsed.body, parsed.description);
  }

  const heading = /^#[ \t]+(.+)$/m.exec(unfenced)?.[1];
  if (heading === undefined) return null;
  return buildDraft(heading, unfenced, undefined);
}

/**
 * Read whatever the model answered as one proposal.
 *
 * A JSON object wins; otherwise a `SKILL.md` is accepted, with the name from
 * its frontmatter or its first heading. `NONE`, prose, an empty body, an empty
 * or unusable name and an over-long body all yield `null`.
 */
export function parseProposal(answer: unknown): SkillDraft | null {
  if (typeof answer !== "string") return null;
  const text = answer.trim();
  if (text.length === 0) return null;
  if (/^(?:none|nothing|no proposal)\.?$/i.test(text)) return null;
  return fromJson(text) ?? fromMarkdown(text);
}

/** The whole skill file for a draft, frontmatter included. */
export function renderSkillFile(draft: SkillDraft): string {
  const description = draft.description.length > 0 ? draft.description : deriveDescription(draft.body);
  return [
    "---",
    `name: ${draft.name}`,
    `description: ${description}`,
    "---",
    "",
    draft.body.trim(),
    "",
  ].join("\n");
}
