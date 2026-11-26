/**
 * Starting a conversation, and what a "new chat" does when one is already open.
 *
 * A conversation is chain state, not a client preference: starting one appends a
 * `session` event with a fresh id, so every device folds the same drawer and the
 * conversation that exists on this machine exists on the others too. The daemon
 * is the only writer, which is why it — and not the app — decides the id.
 *
 * Two rules keep the list honest:
 *
 * - An id is never reused. `readSessions` treats a second `session` event that
 *   names an existing id as a later statement about that conversation (archive,
 *   delete), so appending a new start under an old id would silently swallow the
 *   new conversation. Every start gets a fresh id.
 * - An empty conversation that is already there is adopted instead of
 *   duplicated: the untouched "New chat" from onboarding, or one another device
 *   opened, is the conversation the owner meant. A conversation this process
 *   already handed out is not adopted a second time — asking twice is a real
 *   request for a second chat, and each answer carries its own id.
 */

import { randomUUID } from "node:crypto";
import type { Event, EventStore } from "../chain/store.js";
import { vacantSession, readSessions } from "../chain/sessions.js";

/** The store caps a page; a chain longer than this is not what a drawer reads. */
const READ_LIMIT = 100_000;

export interface OpenSessionOptions {
  /** A name for the conversation; absent means a numbered default. */
  readonly title?: string;
  /** Open from an earlier point in another conversation; nothing is deleted. */
  readonly branchOf?: { readonly session: string; readonly seq: number };
  /**
   * Adopt the newest conversation when it is empty, instead of starting a
   * second empty one. An explicit title or a branch always starts a new one:
   * the caller is asking for something specific to live in it.
   */
  readonly reuseEmpty?: boolean;
  /** Test seam for the id generator; defaults to a random uuid. */
  readonly newId?: () => string;
}

export interface OpenedSession {
  readonly id: string;
  /** True when an event was written, false when an empty conversation was adopted. */
  readonly created: boolean;
  /** The `session` event that was written; null when an empty one was adopted. */
  readonly event: Event | null;
}

/**
 * Opens (or adopts) a conversation and returns its id.
 *
 * `issued` is the caller's memory of the ids it handed out for a new chat; it is
 * updated here so the next request sees what the previous one answered.
 */
export function openSession(
  store: EventStore,
  chain: string,
  node: string,
  issued: Set<string>,
  options: OpenSessionOptions = {},
): OpenedSession {
  const index = readSessions(store.read(chain, 1, READ_LIMIT));

  const mayAdopt =
    options.reuseEmpty === true && options.title === undefined && options.branchOf === undefined;
  if (mayAdopt) {
    const vacant = vacantSession(index, issued);
    if (vacant !== null) {
      issued.add(vacant.id);
      return { id: vacant.id, created: false, event: null };
    }
  }

  const newId = options.newId ?? randomUUID;
  const id = newId();
  const event = store.append(chain, {
    // The event id is its own identity in the chain; the session id is what
    // every later event about this conversation names.
    id: newId(),
    node,
    type: "session",
    data: {
      id,
      title: options.title ?? `Conversation ${String(index.sessions.length + 1)}`,
      ...(options.branchOf === undefined ? {} : { branchOf: options.branchOf }),
    },
  });
  issued.add(id);
  return { id, created: true, event };
}
