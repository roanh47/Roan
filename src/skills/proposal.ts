/**
 * Skill proposals: what the agent learned, kept inert until a person says yes.
 *
 * A finished task sometimes teaches something that will still be true next
 * week: a sequence of steps, a machine's quirk, a command that had to be run
 * twice. The agent may write that down as a skill proposal. A proposal is not a
 * skill. It lives in the chain as an `env` event with `kind: "skill_proposal"`,
 * it is never written into `~/.roan/skills`, and no fold hands it to the prompt.
 * Only a person approves it (a later `env` event with `kind: "skill_approval"`),
 * and only then is it loadable — see `fold.ts`, which owns that invariant.
 *
 * Why `env` and not a new event type: skills are part of the env that travels
 * in the chain (`src/env/types.ts` lists `skills` as an env directory). A
 * proposed skill and an approved skill belong to the same event type that
 * already carries skills, so there is no new member in `EventType` and no
 * protocol version bump.
 *
 * The model call is injected as a plain function, so drafting is testable
 * without a provider, a socket or a network.
 */

import {
  SKILL_APPROVAL_KIND,
  SKILL_PROPOSAL_EVENT,
  SKILL_PROPOSAL_KIND,
  foldSkillProposals,
  type ProposalEventLike,
} from "./fold.js";
import {
  normaliseSkillName,
  parseProposal,
  type SkillDraft,
} from "./parse.js";

export {
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  normaliseSkillName,
  parseProposal,
  renderSkillFile,
  type SkillDraft,
} from "./parse.js";
export {
  SKILL_APPROVAL_KIND,
  SKILL_PROPOSAL_EVENT,
  SKILL_PROPOSAL_KIND,
  approvedSkills,
  foldSkillProposals,
  loadableSkill,
  proposedSkills,
  type ProposalEventLike,
  type ProposalStatus,
  type SkillProposal,
} from "./fold.js";

/** Shortest task summary worth asking a model about; less is noise. */
export const MIN_SUMMARY_CHARS = 12;

/** How much of the summary the prompt carries. */
export const MAX_SUMMARY_CHARS = 4000;

/** The injected model call: one prompt in, one answer out. */
export type ProposalModel = (prompt: string) => Promise<string>;

/** A proposal, ready to append. `status` is always `pending`. */
export interface SkillProposalAppend {
  readonly type: typeof SKILL_PROPOSAL_EVENT;
  readonly data: {
    readonly kind: typeof SKILL_PROPOSAL_KIND;
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly body: string;
    readonly status: "pending";
  };
}

/** An approval, ready to append. */
export interface SkillApprovalAppend {
  readonly type: typeof SKILL_PROPOSAL_EVENT;
  readonly data: {
    readonly kind: typeof SKILL_APPROVAL_KIND;
    readonly id: string;
    readonly status: "approved";
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The proposal id for a skill name. Derived, so two nodes agree without a counter. */
export function proposalId(name: string): string {
  const slug = normaliseSkillName(name);
  return `skill:${slug ?? name.trim()}`;
}

/**
 * The prompt handed to the model. Kept next to the parser so the two stay in
 * step: the instructions ask for the JSON the parser prefers, and say `NONE`
 * for the answer the parser also accepts.
 */
export function buildProposalPrompt(taskSummary: string): string {
  const summary = taskSummary.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_CHARS);
  return [
    "You keep the skills of a personal agent. A skill is a short page of",
    "instructions the agent reads only when a later task calls for it.",
    "",
    "Below is what just happened. If it taught a reusable procedure, a rule or a",
    "machine quirk that will still be true next time, write it down as one skill.",
    "If the task was a one-off, or the lesson is already obvious, answer NONE.",
    "",
    "A good skill is specific, imperative and short: the steps in order, the",
    "commands exactly as they worked, and the traps that cost time. No preamble,",
    "no generic advice, no dates or names of this session.",
    "",
    "Task:",
    summary,
    "",
    'Answer with a JSON object and nothing else: {"name": "<lower-case-hyphen-slug>",',
    '"description": "<one line, at most 160 characters>", "body": "<markdown>"}',
    "or answer NONE.",
  ].join("\n");
}

/**
 * Ask the model for a proposal, or `null` when there is nothing to propose.
 *
 * An empty or too-short summary never reaches the model. A model that fails,
 * answers `NONE` or answers garbage yields `null` as well: a draft is a
 * background nicety, and a failed draft must not fail the turn it came from.
 */
export async function draftSkillProposal(
  taskSummary: string,
  callModel: ProposalModel,
): Promise<SkillDraft | null> {
  const summary = taskSummary.replace(/\s+/g, " ").trim();
  if (summary.length < MIN_SUMMARY_CHARS) return null;

  let answer: string;
  try {
    answer = await callModel(buildProposalPrompt(summary));
  } catch {
    return null;
  }
  return parseProposal(answer);
}

/** The event to append for a draft. Always `pending`, whatever the draft says. */
export function proposalEvent(
  draft: SkillDraft,
  id: string = proposalId(draft.name),
): SkillProposalAppend {
  return {
    type: SKILL_PROPOSAL_EVENT,
    data: {
      kind: SKILL_PROPOSAL_KIND,
      id,
      name: draft.name,
      description: draft.description,
      body: draft.body,
      status: "pending",
    },
  };
}

/** The event that approves a proposal. Refuses an empty id. */
export function approveSkill(id: string): SkillApprovalAppend {
  const clean = nonEmptyString(id);
  if (clean === null) throw new TypeError("approveSkill needs a proposal id");
  return {
    type: SKILL_PROPOSAL_EVENT,
    data: { kind: SKILL_APPROVAL_KIND, id: clean, status: "approved" },
  };
}

/**
 * The approval to append, or `null` when there is nothing left to approve.
 *
 * This is the "once": an unknown id cannot be approved, and a proposal that is
 * already approved is not approved a second time.
 */
export function approveSkillOnce(
  events: readonly ProposalEventLike[],
  id: string,
): SkillApprovalAppend | null {
  const found = foldSkillProposals(events).find((proposal) => proposal.id === id);
  if (found === undefined || found.status !== "pending") return null;
  const clean = nonEmptyString(id);
  return clean === null ? null : approveSkill(clean);
}
