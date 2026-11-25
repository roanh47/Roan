/**
 * The phone's outbound queue.
 *
 * The phone is often offline. Whatever the user does goes into this queue
 * first and only crosses the wire on a flush. The queue keeps events in
 * insertion order, knows no time, starts no timers and does no I/O: the clock
 * comes from outside (`planFlush`) and sending itself happens elsewhere.
 */

import type { Event } from "../sync/types.js";

/** Result of {@link OutboundQueue.planFlush}. */
export interface FlushPlan {
  /** Events that may go out now, in insertion order, at most `max`. */
  send: Event[];
  /** Number of events that stay in the queue. */
  hold: number;
  /** Short line explaining why this is the flush. */
  reason: string;
}

/** What the rest of the app may use from the queue. */
export interface OutboundQueue {
  /**
   * Appends an event to the queue. An event whose id is already in the
   * queue is ignored; returns `true` if it was added.
   */
  enqueue(event: Event): boolean;
  /** The next `n` events in insertion order; `n <= 0` gives an empty list. */
  head(n: number): Event[];
  /** Removes the event with this id from the queue; an unknown id is an error. */
  ack(id: string): void;
  /** Number of events in the queue. */
  size(): number;
  /**
   * Computes what a flush at `nowIso` would send, without changing anything.
   * At most `max` events go along, in insertion order; the rest stays put.
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
 * Creates an empty queue.
 *
 * The factory keeps the storage in a closure, so two queues never see each
 * other's events. The order is that of `enqueue`; `ack` removes and later
 * events move up without losing their relative order.
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
        reason = "queue empty: nothing to send";
      } else if (max === 0) {
        reason = "limit 0: everything stays in the queue";
      } else if (hold === 0) {
        reason = `everything fits: sending ${send.length} events at ${nowIso}`;
      } else {
        reason = `limit ${max}: ${hold} events still waiting after ${nowIso}`;
      }

      return { send, hold, reason };
    },
  };
}
