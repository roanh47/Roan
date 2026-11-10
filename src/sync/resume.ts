/**
 * Pure resume planning: given two sides of the same chain, decide what a peer
 * has to do to converge. No I/O, no sockets, no timers — the caller performs
 * the transfer that the plan describes.
 *
 * A side is described by its head (highest seq it has, 0 when empty) and by
 * `idAt(seq)`, which is what makes conflict detection possible: a shared seq
 * carrying a different id means the two chains diverged and no amount of
 * pulling or pushing can fix that.
 *
 * Note: the backlog sketch also mentioned `have(id: string): boolean`. That is
 * enough to ask "do I already have this event", but not enough to answer
 * "which event do I have at seq N", and the conflict rule needs exactly that.
 * We therefore describe a side with `idAt(seq)` instead; `have` can still be
 * built by the caller from the same data.
 */

/** One side of the chain, as far as planning is concerned. */
export interface ResumeSide {
  /** Highest seq on this side; 0 means the chain is empty here. */
  readonly head: number;
  /** Id of the event at `seq`, or undefined when this side has no such seq. */
  idAt(seq: number): string | undefined;
}

export type ResumeAction = "none" | "pull" | "push" | "conflict";

/** The decision: what to do, from which seq, and why. */
export interface ResumePlan {
  readonly action: ResumeAction;
  /** First seq to transfer. 0 when there is nothing to transfer. */
  readonly from: number;
  /** Short human sentence; names the seq when it matters. */
  readonly reason: string;
}

function noop(): ResumePlan {
  return { action: "none", from: 0, reason: "Both sides are identical; nothing to transfer." };
}

/**
 * Plans a resume between `local` and `remote`.
 *
 * Only the shared range (1 .. min(local.head, remote.head)) is inspected, and
 * the first seq whose ids disagree wins: that is the earliest point where the
 * chains split, and later seqs are meaningless after it.
 */
export function planResume(local: ResumeSide, remote: ResumeSide): ResumePlan {
  const shared = Math.min(local.head, remote.head);

  for (let seq = 1; seq <= shared; seq++) {
    const localId = local.idAt(seq);
    const remoteId = remote.idAt(seq);
    // undefined means "this side cannot tell"; that is not evidence of a split.
    if (localId === undefined || remoteId === undefined) continue;
    if (localId !== remoteId) {
      return {
        action: "conflict",
        from: 0,
        reason: `Seq ${seq} has different ids on each side (${localId} vs ${remoteId}); the chains have diverged.`,
      };
    }
  }

  if (local.head === remote.head) return noop();

  if (remote.head > local.head) {
    return {
      action: "pull",
      from: local.head + 1,
      reason: `Remote is ahead at seq ${remote.head}; pull from seq ${local.head + 1}.`,
    };
  }

  return {
    action: "push",
    from: remote.head + 1,
    reason: `Local is ahead at seq ${local.head}; push from seq ${remote.head + 1}.`,
  };
}
