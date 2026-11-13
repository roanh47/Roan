import type { Event } from "../protocol/types.js";

/**
 * A chain is one history, not one conversation.
 *
 * Everything that ever happened stays in the chain in order; a session is just
 * a stretch of it. That means starting a new conversation never deletes the old
 * one, and rewinding is picking an earlier point — not undoing anything.
 */
export interface SessionInfo {
  readonly id: string;
  readonly title: string;
  readonly startedSeq: number;
  readonly startedAt: number;
  readonly messages: number;
  readonly lastSeq: number;
  /** Set when this session was started from an earlier point in another one. */
  readonly branchOf?: { readonly session: string; readonly seq: number };
}

export interface SessionIndex {
  readonly sessions: readonly SessionInfo[];
  /** Newest session, which is where a new message goes when none is named. */
  readonly active: SessionInfo | null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Every session in the chain, oldest first, with a count of what is in it. */
export function readSessions(events: readonly Event[]): SessionIndex {
  const order: string[] = [];
  const byId = new Map<string, { info: SessionInfo; messages: number; lastSeq: number }>();

  for (const event of events) {
    const data = asRecord(event.data);
    if (event.type === "session") {
      const id = str(data?.["id"]);
      if (id === null) continue;
      const branch = asRecord(data?.["branchOf"]);
      const branchSession = str(branch?.["session"]);
      const branchSeq = typeof branch?.["seq"] === "number" ? branch["seq"] : undefined;
      const info: SessionInfo = {
        id,
        title: str(data?.["title"]) ?? "New conversation",
        startedSeq: event.seq,
        startedAt: event.ts,
        messages: 0,
        lastSeq: event.seq,
        ...(branchSession !== null && branchSeq !== undefined
          ? { branchOf: { session: branchSession, seq: branchSeq } }
          : {}),
      };
      order.push(id);
      byId.set(id, { info, messages: 0, lastSeq: event.seq });
      continue;
    }

    if (event.type !== "message" && event.type !== "assistant") continue;
    const named = str(data?.["session"]);
    const target = named ?? order[order.length - 1];
    if (target === undefined) continue;
    const entry = byId.get(target);
    if (entry === undefined) continue;
    const messages = event.type === "message" ? 1 : 0;
    byId.set(target, {
      info: entry.info,
      messages: entry.messages + messages,
      lastSeq: event.seq,
    });
  }

  const sessions = order.map((id) => {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error("session vanished");
    return {
      ...entry.info,
      messages: entry.messages,
      lastSeq: entry.lastSeq,
    };
  });

  return { sessions, active: sessions[sessions.length - 1] ?? null };
}

/** The events of one session, in order. */
export function sessionEvents(events: readonly Event[], session: string): Event[] {
  const out: Event[] = [];
  let current: string | null = null;
  for (const event of events) {
    const data = asRecord(event.data);
    if (event.type === "session") {
      current = str(data?.["id"]);
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
