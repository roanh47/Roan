import type { Event } from "./types.js";

/**
 * One order for events that compete for the same place in the chain.
 *
 * Two nodes may append at the same moment and both take `head() + 1`. Neither
 * event is wrong and neither may be dropped, so a node keeps its own branch
 * where it is and places the other behind it. That mirror is what makes every
 * event survive, but it leaves the order of *someone else's* branches open: a
 * third node that holds neither branch must still be able to pick the same
 * one. This comparator is that rule: earliest `ts` first, then the node that
 * wrote it, then the event id as the last tiebreak.
 *
 * It is a total order over the fields every event has (all three are required
 * by the wire format), it needs no clock agreement — only a stored timestamp —
 * and it is the same function on every node, so two nodes holding the same
 * siblings always compute the same sequence.
 *
 * Two things follow, and they are not the same claim:
 * - **Content.** Every node ends up with the same set of events, whatever
 *   order its own `seq` numbers happen to give them (`sameEvents`).
 * - **Order.** Siblings that are placed by this rule — a contested batch that
 *   arrives before the gap below it closes — land in the same order everywhere
 *   (`canonicalChain`). A node that holds one of the competing events itself
 *   keeps it first: the mirror is the documented local contract, and the only
 *   way to have both is to let the writer's own place win on the writer.
 */
export function compareBranches(left: Event, right: Event): number {
  if (left.ts !== right.ts) return left.ts < right.ts ? -1 : 1;
  if (left.node !== right.node) return left.node < right.node ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** The same set of sibling events, in the one order every node agrees on. */
export function orderBranches(events: readonly Event[]): Event[] {
  return [...events].sort(compareBranches);
}

/**
 * A chain seen through the ordering rule: sort by `ts`, `node`, `id`.
 *
 * Two nodes that hold the same events in the mirror order still project to the
 * same list here, which is what "converged" means for a chain with more than
 * one writer. Use it to compare what two nodes hold without pretending their
 * local `seq` assignment is identical.
 */
export function canonicalChain(events: readonly Event[]): Event[] {
  return orderBranches(events);
}

/** Ids in canonical order; equal lists mean the two chains hold the same events. */
export function canonicalIds(events: readonly Event[]): string[] {
  return canonicalChain(events).map((event) => event.id);
}

/** Whether two chains hold the same events, whatever their local seqs are. */
export function sameEvents(left: readonly Event[], right: readonly Event[]): boolean {
  if (left.length !== right.length) return false;
  const leftIds = canonicalIds(left);
  const rightIds = canonicalIds(right);
  for (let index = 0; index < leftIds.length; index++) {
    if (leftIds[index] !== rightIds[index]) return false;
  }
  return true;
}
