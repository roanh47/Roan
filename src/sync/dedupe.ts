import type { Event } from "./types.js";

/** Result of cleaning up a series of events. */
export interface DedupeResult {
  /** First event per id, in input order. */
  kept: Event[];
  /** Events that were skipped, in input order. */
  dropped: Event[];
  /** All ids skipped at least once, sorted alphabetically. */
  duplicateIds: string[];
}

/**
 * Keeps the first event per id and per seq.
 *
 * The chain knows two forms of duplicate: the same id again (exact
 * repetition) and the same seq with a different id (the event does not fit at
 * that spot). Both go to `dropped`; the id of the skipped event ends up in
 * `duplicateIds`. The input is never modified.
 */
export function dedupeEvents(events: readonly Event[]): DedupeResult {
  const kept: Event[] = [];
  const dropped: Event[] = [];
  const duplicateIds = new Set<string>();
  const keptIds = new Set<string>();
  const idAtSeq = new Map<number, string>();

  for (const event of events) {
    if (keptIds.has(event.id)) {
      dropped.push(event);
      duplicateIds.add(event.id);
      continue;
    }

    if (idAtSeq.has(event.seq)) {
      dropped.push(event);
      duplicateIds.add(event.id);
      continue;
    }

    kept.push(event);
    keptIds.add(event.id);
    idAtSeq.set(event.seq, event.id);
  }

  return { kept, dropped, duplicateIds: [...duplicateIds].sort() };
}
