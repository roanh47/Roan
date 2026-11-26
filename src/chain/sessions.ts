import type { Event } from "../protocol/types.js";

/**
 * A chain is one history, not one conversation.
 *
 * Everything that ever happened stays in the chain in order; a session is just
 * a stretch of it. That means starting a new conversation never deletes the old
 * one, and rewinding is picking an earlier point — not undoing anything.
 *
 * The same rule covers putting a conversation out of the way: archiving and
 * deleting are later events about a session, never edits to what is already
 * there. A tombstone hides; it does not erase.
 */
export interface SessionInfo {
  readonly id: string;
  readonly title: string;
  readonly startedSeq: number;
  readonly startedAt: number;
  readonly messages: number;
  readonly lastSeq: number;
  /** Out of the way, not gone: hidden from the default list, still readable. */
  readonly archived: boolean;
  /** A tombstone: never listed again, and never removed from the chain either. */
  readonly deleted: boolean;
  /** A temporary chat: leaves the list when it ends, and is never history. */
  readonly ephemeral: boolean;
  /** Set when this session was started from an earlier point in another one. */
  readonly branchOf?: { readonly session: string; readonly seq: number };
}

export interface SessionIndex {
  /** History as the owner wants to see it: no archived, no deleted, no ended temp chat. */
  readonly sessions: readonly SessionInfo[];
  /** Put out of the way but still there, oldest first. Deleted ones are not here. */
  readonly archived: readonly SessionInfo[];
  /**
   * Every session that still counts as a conversation — visible and archived —
   * for looking one up by id. A deleted session or an ended temporary chat is
   * not here: its events stay in the chain, but nothing reopens it.
   */
  readonly all: readonly SessionInfo[];
  /** Newest session, which is where a new message goes when none is named. */
  readonly active: SessionInfo | null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The flags a `session` event may carry on top of the id it names. */
interface Flags {
  title?: string;
  archived?: boolean;
  deleted?: boolean;
  ephemeral?: boolean;
}

const FLAG_KEYS = ["archived", "deleted", "ephemeral"] as const;

function flagsOf(data: Record<string, unknown> | null): Flags {
  const flags: Flags = {};
  const title = str(data?.["title"]);
  if (title !== null) flags.title = title;
  if (data === null) return flags;
  for (const key of FLAG_KEYS) {
    const value = data[key];
    if (typeof value === "boolean") flags[key] = value;
  }
  return flags;
}

/** Every session in the chain, oldest first, with a count of what is in it. */
/**
 * The name a conversation should carry after its first message: the question
 * itself, unless the owner already named it something real. A default title
 * ("New chat", "Conversation N") is a placeholder, not a name — the first
 * turn fixes it, and the rename travels as an event like any other.
 */
export function autoTitleFor(title: string, firstText: string): string | null {
  const trimmed = firstText.trim().slice(0, 60);
  if (trimmed.length === 0) return null;
  if (title === "New chat" || /^Conversation \d+$/.test(title)) return trimmed;
  return null;
}

export function readSessions(events: readonly Event[]): SessionIndex {
  const order: string[] = [];
  const byId = new Map<string, SessionInfo>();

  for (const event of events) {
    const data = asRecord(event.data);
    if (event.type === "session") {
      const id = str(data?.["id"]);
      if (id === null) continue;
      const flags = flagsOf(data);
      const existing = byId.get(id);

      if (existing !== undefined) {
        // A session event that names a session already in the chain is a later
        // statement about it — archive, delete, unarchive — not a second start:
        // it never resets the count, the start or the place in the order.
        // Deletion is a tombstone and stays: nothing turns it back on.
        byId.set(id, {
          ...existing,
          title: flags.title ?? existing.title,
          archived: flags.archived ?? existing.archived,
          deleted: existing.deleted || flags.deleted === true,
          ephemeral: flags.ephemeral ?? existing.ephemeral,
          lastSeq: event.seq,
        });
        continue;
      }

      // A hiding flag for an id this chain never showed has nothing to hide:
      // treat it as a stray tombstone, not as a session nobody ever started.
      const hidesOnly = flags.archived === true || flags.deleted === true;
      if (hidesOnly && flags.title === undefined) continue;

      const branch = asRecord(data?.["branchOf"]);
      const branchSession = str(branch?.["session"]);
      const branchSeq = typeof branch?.["seq"] === "number" ? branch["seq"] : undefined;
      const info: SessionInfo = {
        id,
        title: flags.title ?? "New conversation",
        startedSeq: event.seq,
        startedAt: event.ts,
        messages: 0,
        lastSeq: event.seq,
        archived: flags.archived === true,
        deleted: flags.deleted === true,
        ephemeral: flags.ephemeral === true,
        ...(branchSession !== null && branchSeq !== undefined
          ? { branchOf: { session: branchSession, seq: branchSeq } }
          : {}),
      };
      order.push(id);
      byId.set(id, info);
      continue;
    }

    if (event.type === "session_title") {
      // A rename never rewrites history: it is an event after the facts, so
      // the index folds it into the session it names — archived or not.
      const named = str(data?.["session"]);
      const title = str(data?.["title"]);
      if (named === null || title === null) continue;
      const entry = byId.get(named);
      if (entry === undefined) continue;
      byId.set(named, { ...entry, title, lastSeq: event.seq });
      continue;
    }

    if (event.type !== "message" && event.type !== "assistant") continue;
    const named = str(data?.["session"]);
    const target = named ?? order[order.length - 1];
    if (target === undefined) continue;
    const entry = byId.get(target);
    if (entry === undefined) continue;
    const messages = event.type === "message" ? 1 : 0;
    byId.set(target, { ...entry, messages: entry.messages + messages, lastSeq: event.seq });
  }

  const every = order.map((id) => {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error("session vanished");
    return entry;
  });

  // A temporary chat ends when another session starts after it. From then on it
  // is not history: the events stay in the chain, the listing forgets it, and
  // its messages are counted nowhere in the listing.
  const newestStart = every.reduce((max, info) => Math.max(max, info.startedSeq), 0);
  const ended = (info: SessionInfo): boolean => info.ephemeral && info.startedSeq < newestStart;

  const sessions: SessionInfo[] = [];
  const archived: SessionInfo[] = [];
  const reachable: SessionInfo[] = [];
  for (const info of every) {
    if (info.deleted || ended(info)) continue;
    reachable.push(info);
    if (info.archived) archived.push(info);
    else if (!info.id.startsWith("side:")) sessions.push(info);
  }

  return {
    sessions,
    archived,
    all: reachable,
    active: sessions[sessions.length - 1] ?? null,
  };
}

/**
 * The newest conversation, when it is still empty and nothing has been said in
 * it yet. That is the conversation a fresh "new chat" may adopt instead of
 * starting a second empty one. `issued` holds the ids this daemon already
 * handed out for a new chat: asking twice is a real request for a second
 * conversation, so a conversation this process opened is never adopted again —
 * it would answer the second request with the first id.
 */
export function vacantSession(
  index: SessionIndex,
  issued: ReadonlySet<string> = new Set<string>(),
): SessionInfo | null {
  const newest = index.active;
  if (newest === null) return null;
  if (newest.messages > 0) return null;
  if (issued.has(newest.id)) return null;
  return newest;
}

/** The events of one session, in order. */
export function sessionEvents(events: readonly Event[], session: string): Event[] {
  const out: Event[] = [];
  const started = new Set<string>();
  let current: string | null = null;
  for (const event of events) {
    const data = asRecord(event.data);
    if (event.type === "session") {
      // Only the first mention of an id starts a stretch: a later archive or
      // delete of another session must not move unnamed events to it.
      const id = str(data?.["id"]);
      if (id !== null && !started.has(id)) {
        started.add(id);
        current = id;
      }
      continue;
    }
    const named = str(data?.["session"]);
    if (named !== null ? named === session : current === session) out.push(event);
  }
  return out;
}

/** What the engine should see of one session: the two roles, oldest first. */
export function sessionMessages(
  events: readonly Event[],
  session: string,
): { role: "user" | "assistant"; text: string }[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const event of sessionEvents(events, session)) {
    const data = asRecord(event.data);
    const text = str(data?.["text"]);
    if (text === null) continue;
    if (event.type === "message") out.push({ role: "user", text });
    else if (event.type === "assistant") out.push({ role: "assistant", text });
  }
  return out;
}
