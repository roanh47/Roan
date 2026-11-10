import type { Event } from "./types.js";

/** Uitkomst van het opschonen van een reeks events. */
export interface DedupeResult {
  /** Eerste event per id, in de volgorde van de invoer. */
  kept: Event[];
  /** Events die zijn overgeslagen, in de volgorde van de invoer. */
  dropped: Event[];
  /** Alle ids die minstens één keer zijn overgeslagen, alfabetisch gesorteerd. */
  duplicateIds: string[];
}

/**
 * Houdt het eerste event per id en per seq.
 *
 * De keten kent twee vormen van dubbel: hetzelfde id nog een keer (exacte
 * herhaling) en dezelfde seq met een andere id (het event past niet op die
 * plek). Beide gaan naar `dropped`; de id van het overgeslagen event komt in
 * `duplicateIds`. De invoer wordt nooit aangepast.
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
