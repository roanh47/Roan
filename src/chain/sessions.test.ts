import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";
import { readSessions, sessionMessages } from "./sessions.js";

function event(seq: number, type: Event["type"], data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

const chain: Event[] = [
  event(1, "session", { id: "s1", title: "Eerste" }),
  event(2, "message", { text: "hoi" }),
  event(3, "assistant", { text: "hey" }),
  event(4, "session", { id: "s2", title: "Tweede" }),
  event(5, "message", { text: "nieuw" }),
  event(6, "assistant", { text: "ja" }),
];

test("every session is kept, oldest first", () => {
  const index = readSessions(chain);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s1", "s2"]);
  assert.equal(index.active?.id, "s2");
});

test("messages count per session, not in total", () => {
  const index = readSessions(chain);
  assert.equal(index.sessions[0]?.messages, 1);
  assert.equal(index.sessions[1]?.messages, 1);
});

test("the engine only sees the session it is asked about", () => {
  assert.deepEqual(sessionMessages(chain, "s1"), [
    { role: "user", text: "hoi" },
    { role: "assistant", text: "hey" },
  ]);
  assert.deepEqual(sessionMessages(chain, "s2"), [
    { role: "user", text: "nieuw" },
    { role: "assistant", text: "ja" },
  ]);
});

test("a message that names its session lands there even without a session event", () => {
  const events = [...chain, event(7, "message", { text: "los", session: "s1" })];
  assert.equal(sessionMessages(events, "s1").at(-1)?.text, "los");
});

test("a branch remembers where it started", () => {
  const events = [...chain, event(7, "session", { id: "s3", title: "Tak", branchOf: { session: "s1", seq: 3 } })];
  const branch = readSessions(events).sessions.at(-1);
  assert.deepEqual(branch?.branchOf, { session: "s1", seq: 3 });
});

/** A rename is an event after the facts, never a rewrite of history. */
test("a session_title event renames the session it names", () => {
  const events = [...chain, event(7, "session_title", { session: "s1", title: "Hernoemd" })];
  const index = readSessions(events);
  assert.equal(index.sessions[0]?.title, "Hernoemd");
  assert.equal(index.sessions[1]?.title, "Tweede");
  // The rename itself is not a message.
  assert.equal(index.sessions[0]?.messages, 1);
  assert.deepEqual(sessionMessages(events, "s1"), [
    { role: "user", text: "hoi" },
    { role: "assistant", text: "hey" },
  ]);
});

test("a rename for an unknown session is ignored, not fatal", () => {
  const events = [...chain, event(7, "session_title", { session: "zz", title: "Nergens" })];
  const index = readSessions(events);
  assert.equal(index.sessions.length, 2);
  assert.equal(index.sessions[0]?.title, "Eerste");
});
