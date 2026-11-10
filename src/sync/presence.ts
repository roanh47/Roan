import type { Event, HelloFrame } from "./types.js";

/**
 * Lokale administratie van wie er leeft en hoe ver die staat.
 *
 * Presence doet zelf niets met het netwerk: geen sockets, geen timers. De
 * aanroeper meldt een hello of een event en levert de klok (`now`) aan; de
 * vervaltijd wordt bij het lezen toegepast. Zo is het gedrag deterministisch
 * te testen en kan niets in deze module uit zichzelf "verlopen".
 *
 * Een node die na zijn TTL opnieuw iets laat horen, krijgt gewoon dezelfde
 * entry met een verse `lastSeen`; er komt geen tweede entry bij.
 */

export interface PresenceOptions {
  /** Hoe lang een node na zijn laatste teken van leven live blijft. */
  ttlMs?: number;
  /** Klok in ms; standaard `Date.now`. */
  now?: () => number;
}

export interface PresenceEntry {
  node: string;
  chain: string;
  /** Hoogste seq die we van deze node kennen. */
  head: number;
  transportLabel?: string;
  /** Klokwaarde (ms) van het laatste teken van leven. */
  lastSeen: number;
  /** Of `lastSeen` op het moment van lezen binnen de TTL valt. */
  live: boolean;
}

export interface PresenceSnapshot {
  chain: string | null;
  live: PresenceEntry[];
  stale: PresenceEntry[];
}

/** Standaard TTL: een halve minuut zonder teken van leven is niet meer live. */
export const DEFAULT_PRESENCE_TTL_MS = 30_000;

interface PresenceRecord {
  node: string;
  chain: string;
  head: number;
  transportLabel: string | undefined;
  lastSeen: number;
}

export class Presence {
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly records = new Map<string, PresenceRecord>();
  /** De keten waar deze presence bij hoort; `null` tot de eerste melding. */
  private chainValue: string | null = null;

  constructor(options: PresenceOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_PRESENCE_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError(`ongeldige ttlMs: ${String(ttlMs)}`);
    }
    this.ttlMs = ttlMs;
    this.clock = options.now ?? Date.now;
  }

  /** Ketennaam zoals die uit de eerste hello of het eerste event kwam. */
  get chain(): string | null {
    return this.chainValue;
  }

  /**
   * Verwerkt een hello van een peer. `haveSeq` is wat de peer zegt te hebben;
   * een eerder waargenomen hogere head zakt nooit terug, want events die we al
   * zagen zijn echt gebeurd.
   */
  seeHello(hello: HelloFrame, transportLabel?: string): void {
    const now = this.clock();
    this.adoptChain(hello.chain, hello.node);

    const existing = this.records.get(hello.node);
    if (existing === undefined) {
      this.records.set(hello.node, {
        node: hello.node,
        chain: hello.chain,
        head: hello.haveSeq,
        transportLabel,
        lastSeen: now,
      });
      return;
    }

    existing.head = Math.max(existing.head, hello.haveSeq);
    existing.lastSeen = now;
    if (transportLabel !== undefined) existing.transportLabel = transportLabel;
  }

  /**
   * Verwerkt een event: de afzender leeft en zit minstens op `event.seq`.
   * Alleen een hogere seq dan we kennen verhoogt de head.
   */
  seeEvent(event: Event, transportLabel?: string): void {
    const now = this.clock();
    this.adoptChain(event.chain, event.node);

    const existing = this.records.get(event.node);
    if (existing === undefined) {
      this.records.set(event.node, {
        node: event.node,
        chain: event.chain,
        head: event.seq,
        transportLabel,
        lastSeen: now,
      });
      return;
    }

    if (event.seq > existing.head) existing.head = event.seq;
    existing.lastSeen = now;
    if (transportLabel !== undefined) existing.transportLabel = transportLabel;
  }

  /** Een transport naar deze node is dicht; de node is niet langer aanwezig. */
  drop(node: string): void {
    this.records.delete(node);
  }

  /** Nodes die op dit moment binnen de TTL vallen, op naam gesorteerd. */
  live(): PresenceEntry[] {
    return this.collect(this.clock(), true);
  }

  /** Nodes waarvan `lastSeen` ouder is dan de TTL, op naam gesorteerd. */
  stale(now?: number): PresenceEntry[] {
    return this.collect(now ?? this.clock(), false);
  }

  /**
   * Hoogste seq van een node, of `undefined` als we hem niet kennen of als hij
   * verlopen is: de head van een dode node is geen live stand.
   */
  head(node: string): number | undefined {
    const record = this.records.get(node);
    if (record === undefined) return undefined;
    if (!this.isLive(record, this.clock())) return undefined;
    return record.head;
  }

  snapshot(): PresenceSnapshot {
    const now = this.clock();
    return {
      chain: this.chainValue,
      live: this.collect(now, true),
      stale: this.collect(now, false),
    };
  }

  // --- intern ------------------------------------------------------------

  /** De eerste melding zet de keten; elke andere keten is een fout, geen ruis. */
  private adoptChain(chain: string, node: string): void {
    if (this.chainValue === null) {
      this.chainValue = chain;
      return;
    }
    if (chain !== this.chainValue) {
      throw new Error(
        `keten-mismatch: node "${node}" meldt keten "${chain}", maar presence volgt keten "${this.chainValue}"`,
      );
    }
  }

  /** Precies op de TTL-grens telt als live; pas daarna is een node oud. */
  private isLive(record: PresenceRecord, now: number): boolean {
    return now - record.lastSeen <= this.ttlMs;
  }

  private collect(now: number, wantLive: boolean): PresenceEntry[] {
    const entries: PresenceEntry[] = [];
    const nodes = [...this.records.keys()].sort();
    for (const node of nodes) {
      const record = this.records.get(node);
      if (record === undefined) continue;
      const live = this.isLive(record, now);
      if (live !== wantLive) continue;
      entries.push({
        node: record.node,
        chain: record.chain,
        head: record.head,
        transportLabel: record.transportLabel,
        lastSeen: record.lastSeen,
        live,
      });
    }
    return entries;
  }
}
