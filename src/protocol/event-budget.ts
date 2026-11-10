/**
 * Byte budget for one event on the wire.
 *
 * A transport frame is JSON text, so the cost of an event is the UTF-8 length
 * of its serialised form — not the number of characters in its fields and not
 * the size of `data` alone. `eventBytes` measures exactly what
 * `JSON.stringify` would put on the wire for the whole event, `data` included;
 * skipping `data` would under-report the very payload that makes events big.
 *
 * `checkEventBudget` compares that measurement against a cap and names the
 * field that dominates the event, so a caller can tell *what* to shrink without
 * ever looking at (or logging) the field's content.
 */

import type { Event } from "../sync/types.js";
import { byteLength } from "./size.js";

export interface EventBudgetResult {
  /** True when the event fits: `bytes <= maxBytes`. */
  ok: boolean;
  /** Measured size of the whole serialised event, in UTF-8 bytes. */
  bytes: number;
  /** Key of the event field with the largest serialised size; never its content. */
  largestField: string;
}

/** UTF-8 size of `value` as JSON text; `undefined` counts as zero bytes. */
function serialisedBytes(value: unknown): number {
  const text = JSON.stringify(value);
  if (text === undefined) return 0;
  return byteLength(text);
}

/**
 * Size of `event` in UTF-8 bytes once serialised as JSON.
 *
 * The whole event is measured — `v`, `chain`, `seq`, `id`, `node`, `ts`,
 * `type` and `data` — because that text, not any single field, is what travels
 * to a peer.
 */
export function eventBytes(event: Event): number {
  return byteLength(JSON.stringify(event));
}

function invalidMaxBytes(maxBytes: number): Error {
  return new Error(
    `checkEventBudget: maxBytes must be a positive safe integer, got ${String(maxBytes)}`,
  );
}

/**
 * Compare the serialised size of `event` against `maxBytes`.
 *
 * `largestField` is the key whose JSON serialisation is biggest; ties are
 * broken alphabetically by key, so the answer is stable across runs. Only key
 * names are reported, never field contents.
 *
 * Throws when `maxBytes` is not a positive safe integer.
 */
export function checkEventBudget(
  event: Event,
  maxBytes: number,
): EventBudgetResult {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw invalidMaxBytes(maxBytes);
  }

  const bytes = eventBytes(event);

  let largestField = "";
  let largestBytes = -1;
  for (const [key, value] of Object.entries(event)) {
    const size = serialisedBytes(value);
    const bigger = size > largestBytes;
    const tiedButEarlier = size === largestBytes && key < largestField;
    if (bigger || tiedButEarlier) {
      largestBytes = size;
      largestField = key;
    }
  }

  return { ok: bytes <= maxBytes, bytes, largestField };
}
