import type { AppendOutcome, Event, NodeStore, Unsubscribe } from "./types.js";

export interface MemoryStoreOptions {
  chain: string;
  nodeId: string;
  /** Begininhoud; moet aaneengesloten zijn vanaf seq 1. */
  events?: Event[];
}

export interface MemoryStore extends NodeStore {
  all(): Event[];
}

/**
 * In-memory store met dezelfde invarianten als de echte opslag: alleen appenden,
 * alleen op head + 1, nooit overschrijven. Bedoeld voor tests en als voorbeeld
 * van hoe `NodeStore` hoort te gedragen.
 */
export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const events: Event[] = [];
  const ids = new Set<string>();
  const listeners = new Set<(event: Event) => void>();

  const head = (): number => events.length;
  const idAt = (seq: number): string | undefined => events[seq - 1]?.id;

  const append = (event: Event): AppendOutcome => {
    if (ids.has(event.id)) return { status: "duplicate" };
    if (event.seq <= events.length) {
      const existing = events[event.seq - 1];
      return { status: "conflict", existingId: existing?.id ?? "" };
    }
    if (event.seq !== events.length + 1) {
      throw new Error(`store gap: kan seq ${event.seq} niet toevoegen na ${events.length}`);
    }
    events.push(event);
    ids.add(event.id);
    for (const listener of listeners) listener(event);
    return { status: "appended" };
  };

  const store: MemoryStore = {
    chain: options.chain,
    nodeId: options.nodeId,
    head,
    idAt,
    has: (id: string): boolean => ids.has(id),
    since: (from: number): Event[] =>
      events.filter((event) => event.seq >= Math.max(0, from)),
    append,
    subscribe: (listener: (event: Event) => void): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    all: (): Event[] => [...events],
  };

  for (const event of options.events ?? []) {
    const outcome = append(event);
    if (outcome.status !== "appended") {
      throw new Error(`ongeldige begininhoud op seq ${event.seq}: ${outcome.status}`);
    }
  }

  return store;
}
