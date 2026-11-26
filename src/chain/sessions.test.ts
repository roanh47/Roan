import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";
import { autoTitleFor } from "./sessions.js";
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

test("the first message names a default-titled conversation after itself", () => {
  assert.equal(autoTitleFor("New chat", "wat doet poort 7412 eigenlijk?"), "wat doet poort 7412 eigenlijk?");
  assert.equal(autoTitleFor("Conversation 3", "hoeveel kost een tarief van 8 uur"), "hoeveel kost een tarief van 8 uur");
  // A real name stays: the owner named it, the first turn does not overrule.
  assert.equal(autoTitleFor("Poortvraag", "wat doet poort 7412?"), null);
  assert.equal(autoTitleFor("Rewind to #4", "nog een vraag"), null);
  // No text, no rename.
  assert.equal(autoTitleFor("New chat", "   "), null);
});

/** Archiving is a later event about a session, never an edit to its events. */
test("archiving hides a session from the list, not from the chain", () => {
  const events = [...chain, event(7, "session", { id: "s1", archived: true })];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s2"]);
  assert.deepEqual(index.archived.map((s) => s.id), ["s1"]);
  assert.equal(index.archived[0]?.archived, true);
  // Readable, counted and findable by id — the list is the only thing shorter.
  assert.equal(index.archived[0]?.messages, 1);
  assert.deepEqual(index.all.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(sessionMessages(events, "s1").map((m) => m.text), ["hoi", "hey"]);
  assert.equal(events.length, 7);
});

test("unarchiving brings a session back without starting it again", () => {
  const events = [
    ...chain,
    event(7, "session", { id: "s1", archived: true }),
    event(8, "session", { id: "s1", archived: false }),
  ];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(index.archived, []);
  // A flag is folded into the session that is already there: start, count and
  // place in the order stay what they were.
  assert.equal(index.sessions[0]?.startedSeq, 1);
  assert.equal(index.sessions[0]?.messages, 1);
  assert.equal(index.active?.id, "s2");
});

test("a delete tombstone hides the session and keeps every event", () => {
  const events = [...chain, event(7, "session", { id: "s1", deleted: true })];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s2"]);
  assert.deepEqual(index.archived, []);
  assert.deepEqual(index.all.map((s) => s.id), ["s2"]);
  // Append-only: nothing was erased, the session is only not listed.
  assert.deepEqual(sessionMessages(events, "s1").map((m) => m.text), ["hoi", "hey"]);
  assert.equal(events.filter((e) => e.type === "message" || e.type === "assistant").length, 4);
});

test("a tombstone is final: nothing later turns a deleted session back on", () => {
  const events = [
    ...chain,
    event(7, "session", { id: "s1", deleted: true }),
    event(8, "session", { id: "s1", deleted: false, archived: false, title: "Toch" }),
    event(9, "session_title", { session: "s1", title: "Weer" }),
  ];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s2"]);
  assert.deepEqual(index.archived, []);
  assert.deepEqual(index.all.map((s) => s.id), ["s2"]);
});

test("a later rename of an archived session still folds", () => {
  const events = [
    ...chain,
    event(7, "session", { id: "s1", archived: true }),
    event(8, "session_title", { session: "s1", title: "Bewaard" }),
    event(9, "message", { text: "en toch", session: "s1" }),
  ];
  const index = readSessions(events);
  // The rename does not resurrect it in the default list…
  assert.deepEqual(index.sessions.map((s) => s.id), ["s2"]);
  // …but the archived entry carries the new name and the new message.
  const row = index.archived[0];
  assert.equal(row?.id, "s1");
  assert.equal(row?.title, "Bewaard");
  assert.equal(row?.archived, true);
  assert.equal(row?.messages, 2);
});

test("an archive event does not move unnamed messages to the archived session", () => {
  const events = [
    ...chain,
    event(7, "session", { id: "s1", archived: true }),
    event(8, "message", { text: "nog hier" }),
  ];
  const index = readSessions(events);
  const s2 = index.sessions.find((s) => s.id === "s2");
  assert.equal(s2?.messages, 2);
  assert.deepEqual(sessionMessages(events, "s1").map((m) => m.text), ["hoi", "hey"]);
});

test("a tombstone for a session that never started adds nothing", () => {
  const events = [...chain, event(7, "session", { id: "zz", deleted: true })];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(index.archived, []);
  assert.deepEqual(index.all.map((s) => s.id), ["s1", "s2"]);
});

/** A temporary chat is a conversation you are in, not one you keep. */
test("a temporary chat is listed while it is the one you are in", () => {
  const events = [...chain, event(7, "session", { id: "t1", title: "Tijdelijk", ephemeral: true })];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s1", "s2", "t1"]);
  assert.equal(index.sessions[2]?.ephemeral, true);
  assert.equal(index.active?.id, "t1");
});

test("a temporary chat leaves the history when it ends, its events stay in the chain", () => {
  const events = [
    ...chain,
    event(7, "session", { id: "t1", title: "Tijdelijk", ephemeral: true }),
    event(8, "message", { text: "geheim" }),
    event(9, "assistant", { text: "ok" }),
    event(10, "session", { id: "s3", title: "Daarna" }),
    event(11, "message", { text: "verder" }),
  ];
  const index = readSessions(events);
  assert.deepEqual(index.sessions.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(index.all.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(index.archived, []);
  assert.equal(index.active?.id, "s3");
  // Its messages are counted nowhere in the listing any more.
  assert.equal(index.sessions.reduce((sum, s) => sum + s.messages, 0), 3);
  // And it is still in the chain, question and answer intact.
  assert.deepEqual(sessionMessages(events, "t1").map((m) => m.text), ["geheim", "ok"]);
});
