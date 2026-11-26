/**
 * Taking a device out of the chain.
 *
 * Membership is not a table somewhere: it is the fold over `node` and
 * `node_remove` events (`foldNodeRoster`). So removing a device is one more
 * event — `{ type: "node_remove", data: { node, by } }` — and every device that
 * folds the chain reaches the same list, whether it was the one that asked or
 * not. Any member may remove any other member; no device holds a veto.
 *
 * Two rules live here, because they are about the chain rather than the socket:
 *
 * - A device never removes itself. It is running; its own next announcement
 *   would put it straight back, so the request is refused with the reason
 *   instead of being written and immediately undone.
 * - The event names the device by id. A person may say the name ("Roans
 *   telefoon"), so a name is resolved against the visible roster first — and the
 *   resolution refuses an ambiguous name rather than guessing.
 *
 * Asking to remove a device that is already out of the chain is not an error and
 * writes nothing: the fold already says what the caller wanted to say.
 */

import { randomUUID } from "node:crypto";
import type { Event, EventStore } from "../chain/store.js";
import { describeNodes, findNode, foldNodeRoster } from "../chain/nodes.js";

/** The store caps a page; a chain longer than this is not what a roster reads. */
const READ_LIMIT = 100_000;

export type RemoveNodeResult =
  | {
      readonly ok: true;
      /** The event that was written; null when the device was already out. */
      readonly event: Event | null;
      /** Id of the device the caller asked to remove. */
      readonly node: string;
      /** Its name when it was still visible, for a log line a person can read. */
      readonly name: string | null;
    }
  | { readonly ok: false; readonly message: string };

/** Why a device cannot be removed; one wording, used wherever it is refused. */
export const CANNOT_REMOVE_SELF =
  "cannot remove this device: it is the one you are talking to, and a live device is not a ghost";

/**
 * Writes the removal of `wanted` from the chain kept by `self`.
 *
 * `wanted` is a node id, or a name/address a person would say. Returns the
 * event it wrote (or null when the device was already hidden), or the reason
 * nothing could be done.
 */
export function removeNode(
  store: EventStore,
  chain: string,
  self: string,
  wanted: string,
  newId: () => string = () => randomUUID(),
): RemoveNodeResult {
  const roster = foldNodeRoster(store.read(chain, 1, READ_LIMIT));
  const needle = wanted.trim();
  if (needle.length === 0) {
    return { ok: false, message: "node_remove needs the id of the device to remove" };
  }
  if (needle === self) return { ok: false, message: CANNOT_REMOVE_SELF };

  const target = roster.visible.find((entry) => entry.node === needle) ?? findNode(roster.visible, needle);
  if (target === null) {
    // Already gone is exactly what the caller asked for; a second removal must
    // not fail, and must not stack tombstones either.
    if (roster.removed.has(needle)) return { ok: true, event: null, node: needle, name: null };
    return {
      ok: false,
      message: `no machine called ${JSON.stringify(needle)} in this chain; known: ${describeNodes(roster.visible)}`,
    };
  }
  // A name can resolve to this very device ("Roans-Server" while sitting at
  // it); that is the same refusal as passing its id.
  if (target.node === self) return { ok: false, message: CANNOT_REMOVE_SELF };

  const event = store.append(chain, {
    id: newId(),
    node: self,
    type: "node_remove",
    data: { node: target.node, by: self },
  });
  return { ok: true, event, node: target.node, name: target.name };
}
