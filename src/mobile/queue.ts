/**
 * Uitgaande wachtrij van de telefoon.
 *
 * De telefoon is vaak offline. Wat de gebruiker doet gaat eerst in deze
 * wachtrij en pas bij een flush over de lijn. De wachtrij bewaart events in
 * invoegvolgorde, kent geen tijd, start geen timers en doet geen I/O: de klok
 * komt van buiten (`planFlush`) en het versturen zelf gebeurt elders.
 */

import type { Event } from "../sync/types.js";

/** Uitkomst van {@link OutboundQueue.planFlush}. */
export interface FlushPlan {
  /** Events die nu verstuurd mogen worden, in invoegvolgorde, hooguit `max`. */
  send: Event[];
  /** Aantal events dat in de wachtrij blijft staan. */
  hold: number;
  /** Korte Nederlandse regel die uitlegt waarom dit de flush is. */
  reason: string;
}

/** Wat de rest van de app van de wachtrij mag gebruiken. */
export interface OutboundQueue {
  /**
   * Zet een event achteraan in de wachtrij. Een event waarvan het id al in de
   * wachtrij staat wordt genegeerd; geeft `true` als het is toegevoegd.
   */
  enqueue(event: Event): boolean;
  /** De eerstvolgende `n` events in invoegvolgorde; `n <= 0` geeft een lege lijst. */
  head(n: number): Event[];
  /** Haalt het event met dit id uit de wachtrij; onbekend id is een fout. */
  ack(id: string): void;
  /** Aantal events in de wachtrij. */
  size(): number;
  /**
   * Berekent wat een flush op `nowIso` zou versturen, zonder iets te wijzigen.
   * Hooguit `max` events gaan mee, in invoegvolgorde; de rest blijft staan.
   */
  planFlush(nowIso: string, max: number): FlushPlan;
}

function requireCount(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field}: expected an integer, got ${String(value)}`);
  }
  return value;
}

/**
 * Maakt een lege wachtrij.
 *
 * De fabriek houdt de opslag in een closure, zodat twee wachtrijen elkaars
 * events nooit zien. De volgorde is die van `enqueue`; `ack` verwijdert en
 * latere events schuiven naar voren zonder hun onderlinge volgorde te verliezen.
 */
export function createOutboundQueue(): OutboundQueue {
  const pending = new Map<string, Event>();

  const take = (count: number): Event[] => {
    if (count <= 0) {
      return [];
    }
    const taken: Event[] = [];
    for (const event of pending.values()) {
      if (taken.length >= count) {
        break;
      }
      taken.push(event);
    }
    return taken;
  };

  return {
    enqueue(event: Event): boolean {
      if (pending.has(event.id)) {
        return false;
      }
      pending.set(event.id, event);
      return true;
    },

    head(n: number): Event[] {
      const count = requireCount(n, "head(n)");
      return take(count);
    },

    ack(id: string): void {
      if (!pending.delete(id)) {
        throw new Error(`ack: unknown event id "${id}" is not queued`);
      }
    },

    size(): number {
      return pending.size;
    },

    planFlush(nowIso: string, max: number): FlushPlan {
      if (typeof nowIso !== "string" || nowIso.length === 0) {
        throw new Error(`planFlush: nowIso must be a non-empty ISO string, got ${String(nowIso)}`);
      }
      if (typeof max !== "number" || !Number.isFinite(max) || !Number.isInteger(max)) {
        throw new Error(`planFlush: max must be an integer, got ${String(max)}`);
      }
      if (max < 0) {
        throw new Error(`planFlush: max must not be negative, got ${max}`);
      }

      const total = pending.size;
      const send = take(max);
      const hold = total - send.length;

      let reason: string;
      if (total === 0) {
        reason = "wachtrij leeg: niets te versturen";
      } else if (max === 0) {
        reason = "limiet 0: alles blijft in de wachtrij";
      } else if (hold === 0) {
        reason = `alles past: ${send.length} events versturen om ${nowIso}`;
      } else {
        reason = `limiet ${max}: ${hold} events wachten nog na ${nowIso}`;
      }

      return { send, hold, reason };
    },
  };
}
