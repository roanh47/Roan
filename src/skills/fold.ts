/**
 * Folding skill proposals out of the chain.
 *
 * A proposal is proposed once and approved once, and the fold is the only thing
 * that decides which it is. It is pure — no store, no clock, no disk — so every
 * node that has the events reaches the same answer.
 *
 * The invariant this file exists for: a pending proposal is never loadable.
 * `loadableSkill` is the only door from a proposal to a skill, and it opens for
 * `approved` only. Status is never taken from a proposal event's own payload,
 * so an agent cannot approve itself by claiming it was approved; approval is a
 * separate event, and only a person appends that.
 */

import {
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  deriveDescription,
  normaliseSkillName,
  type SkillDraft,
} from "./parse.js";

/** `data.kind` of a proposal. */
export const SKILL_PROPOSAL_KIND = "skill_proposal" as const;

/** `data.kind` of an approval. */
export const SKILL_APPROVAL_KIND = "skill_approval" as const;

/** `data.kind` of a person saying no to a proposal. */
export const SKILL_REJECTION_KIND = "skill_rejection" as const;

/** The event type a proposal rides: skills travel in the env. */
export const SKILL_PROPOSAL_EVENT = "env" as const;

/** Where a proposal stands. Nothing but `approved` can ever be loaded. */
export type ProposalStatus = "pending" | "approved" | "rejected";

/** One proposal as folded from the chain. */
export interface SkillProposal {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly status: ProposalStatus;
  /** Seq of the event that introduced the proposal; the ordering key. */
  readonly seq: number;
  /** Seq of the first approval; absent while pending. */
  readonly approvedSeq?: number;
}

/** The minimum a fold needs; the chain's `Event` satisfies it. */
export interface ProposalEventLike {
  readonly type: string;
  readonly data: unknown;
  readonly seq?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** A finite seq, or `fallback` when the event carries none. */
function seqOf(event: ProposalEventLike, fallback: number): number {
  return typeof event.seq === "number" && Number.isFinite(event.seq) ? event.seq : fallback;
}

/**
 * Every proposal in the chain, in the order their events appear.
 *
 * A newer `skill_proposal` for the same id rewrites the text but never the
 * status: a person who approved a skill does not lose that by the agent
 * rewording it afterwards. An approval for an id no proposal introduced is
 * ignored — an approval can only approve something that exists. A second
 * approval changes nothing and keeps the first one's seq.
 *
 * Events are folded in the order given; callers pass chain order (ascending
 * `seq`), exactly as `foldGoals` expects.
 */
export function foldSkillProposals(events: readonly ProposalEventLike[]): SkillProposal[] {
  const byId = new Map<string, SkillProposal>();

  for (const event of events) {
    if (event.type !== SKILL_PROPOSAL_EVENT) continue;
    const data = asRecord(event.data);
    if (data === null) continue;
    const kind = data["kind"];

    if (kind === SKILL_PROPOSAL_KIND) {
      const name = normaliseSkillName(data["name"]);
      if (name === null) continue;
      const body = nonEmptyString(data["body"]);
      if (body === null || body.length > MAX_BODY_CHARS) continue;

      const id = nonEmptyString(data["id"]) ?? `skill:${name}`;
      const previous = byId.get(id);
      const description = nonEmptyString(data["description"])?.slice(0, MAX_DESCRIPTION_CHARS);

      byId.set(id, {
        id,
        name,
        description: description ?? previous?.description ?? deriveDescription(body),
        body,
        // Status is never read from the payload: a proposal event proposes.
        // A reworded proposal the owner once refused is a new question.
        status: previous?.status === "approved" ? "approved" : "pending",
        seq: previous?.seq ?? seqOf(event, 0),
        ...(previous?.approvedSeq !== undefined ? { approvedSeq: previous.approvedSeq } : {}),
      });
      continue;
    }

    if (kind === SKILL_REJECTION_KIND) {
      // A no only answers a proposal that is still waiting; it never takes
      // back an approval.
      const refused = nonEmptyString(data["id"]);
      const waiting = refused === null ? undefined : byId.get(refused);
      if (waiting !== undefined && waiting.status === "pending") {
        byId.set(waiting.id, { ...waiting, status: "rejected" });
      }
      continue;
    }

    if (kind !== SKILL_APPROVAL_KIND) continue;
    if (data["status"] !== undefined && data["status"] !== "approved") continue;
    const id = nonEmptyString(data["id"]);
    if (id === null) continue;
    const previous = byId.get(id);
    if (previous === undefined || previous.status !== "pending") continue;

    byId.set(id, { ...previous, status: "approved", approvedSeq: seqOf(event, 0) });
  }

  return [...byId.values()];
}

/** The proposals still waiting for a person, oldest first. */
export function proposedSkills(events: readonly ProposalEventLike[]): SkillProposal[] {
  return foldSkillProposals(events)
    .filter((proposal) => proposal.status === "pending")
    .sort((a, b) => a.seq - b.seq);
}

/** The proposals a person approved. */
export function approvedSkills(events: readonly ProposalEventLike[]): SkillProposal[] {
  return foldSkillProposals(events).filter((proposal) => proposal.status === "approved");
}

/**
 * The draft behind an approved proposal, or `null`.
 *
 * A pending or unknown name resolves to `null`, never to the body the agent
 * wrote for itself.
 */
export function loadableSkill(
  events: readonly ProposalEventLike[],
  name: string,
): SkillDraft | null {
  const wanted = normaliseSkillName(name);
  if (wanted === null) return null;
  for (const proposal of foldSkillProposals(events)) {
    if (proposal.status !== "approved" || proposal.name !== wanted) continue;
    return { name: proposal.name, description: proposal.description, body: proposal.body };
  }
  return null;
}
