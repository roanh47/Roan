/**
 * Pure conflict reporting: compares two sides of the same chain and says, in
 * words a person can read, how far apart they are. No I/O, no sockets, no
 * timers — this only describes what `planResume` already decided.
 *
 * The classification is deliberately the same shape as the resume plan:
 *   - `none`     both heads agree and every shared seq carries the same id;
 *   - `ahead`    the shared range matches and one head is further along;
 *   - `conflict` a shared seq carries different ids, so the chains diverged.
 *
 * A side that cannot report an id at a seq (`undefined`) is not evidence of a
 * split; that seq is skipped, exactly as the planner does.
 */

/** One side of the chain: its head and how to look up the id at a seq. */
export interface Side {
  /** Highest seq on this side; 0 means the chain is empty here. */
  readonly head: number;
  /** Id of the event at `seq`, or undefined when this side has no such seq. */
  idAt(seq: number): string | undefined;
}

export type ConflictKind = "none" | "ahead" | "conflict";

/** The verdict plus the sentences that explain it. */
export interface ConflictReport {
  readonly kind: ConflictKind;
  readonly lines: string[];
}

/** Which side is which, for error messages and prose. */
type SideName = "local" | "remote";

function checkHead(side: Side, name: SideName): void {
  const head = side.head;
  if (!Number.isInteger(head)) {
    throw new Error(`${name}.head must be an integer, got ${head}.`);
  }
  if (head < 0) {
    throw new Error(`${name}.head must not be negative, got ${head}.`);
  }
}

function noop(head: number): ConflictReport {
  return {
    kind: "none",
    lines: [`Both sides are at seq ${head} with matching ids; nothing to reconcile.`],
  };
}

/**
 * Describes how `local` and `remote` differ.
 *
 * Only the shared range (1 .. min(local.head, remote.head)) is inspected, and
 * the first seq whose ids disagree is reported: that is the earliest point
 * where the chains split, and later seqs are meaningless after it.
 */
export function describeConflict(local: Side, remote: Side): ConflictReport {
  checkHead(local, "local");
  checkHead(remote, "remote");

  const shared = Math.min(local.head, remote.head);

  for (let seq = 1; seq <= shared; seq++) {
    const localId = local.idAt(seq);
    const remoteId = remote.idAt(seq);
    // undefined means "this side cannot tell"; that is not evidence of a split.
    if (localId === undefined || remoteId === undefined) continue;
    if (localId !== remoteId) {
      return {
        kind: "conflict",
        lines: [
          `Seq ${seq} has different ids on each side: local has ${localId}, remote has ${remoteId}.`,
          "The chains have diverged; no transfer can reconcile them past this point.",
        ],
      };
    }
  }

  if (local.head === remote.head) return noop(local.head);

  const aheadSide: SideName = local.head > remote.head ? "local" : "remote";
  const behindSide: SideName = aheadSide === "local" ? "remote" : "local";
  const aheadHead = Math.max(local.head, remote.head);
  const behindHead = Math.min(local.head, remote.head);
  const gap = aheadHead - behindHead;

  return {
    kind: "ahead",
    lines: [
      `${aheadSide} is ahead of ${behindSide} by ${gap} ${gap === 1 ? "event" : "events"} ` +
        `(${aheadSide} head ${aheadHead}, ${behindSide} head ${behindHead}).`,
      `Shared seqs 1..${shared} match, so ${behindSide} can catch up from seq ${behindHead + 1}.`,
    ],
  };
}
