import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initSchema } from "../chain/schema.js";
import { EventStore } from "../chain/store.js";
import type { Event } from "../protocol/types.js";
import {
  DEFAULT_MEMORY_LIMIT,
  queryTerms,
  searchMemories,
  searchMemoryEvents,
  searchStoreMemories,
  type MemoryEventLike,
} from "./search.js";

/** A real store in memory, with the production schema, no files on disk. */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initSchema(db);
  return db;
}

function put(
  db: DatabaseSync,
  chain: string,
  seq: number,
  type: Event["type"],
  data: unknown,
  ts = seq,
): void {
  db.prepare(
    `INSERT INTO events (chain, seq, id, node, ts, type, data)
     VALUES (:chain, :seq, :id, :node, :ts, :type, :data)`,
  ).run({
    chain,
    seq,
    id: `${chain}-${String(seq)}`,
    node: "n",
    ts,
    type,
    data: JSON.stringify(data),
  });
}

function memory(chain: string, seq: number, text: string, source = "s1"): MemoryEventLike {
  return { chain, seq, type: "memory", data: { text, source } };
}

function message(chain: string, seq: number, text: string, session?: string): MemoryEventLike {
  return { chain, seq, type: "message", data: session === undefined ? { text } : { text, session } };
}

test("a hit names the event and the session it came from", () => {
  const db = freshDb();
  put(db, "c", 2, "memory", { text: "Works on Linux, prefers Debian", source: "sess-7" });

  const hits = searchMemories(db, "debian");
  assert.equal(hits.length, 1);
  const hit = hits[0]!;
  assert.equal(hit.text, "Works on Linux, prefers Debian");
  assert.equal(hit.kind, "memory");
  assert.equal(hit.source.chain, "c");
  assert.equal(hit.source.seq, 2);
  assert.equal(hit.source.session, "sess-7");
  assert.ok(hit.score > 0);
});

test("messages are searched too, and carry their session when they name one", () => {
  const db = freshDb();
  put(db, "c", 1, "message", { text: "deploy the staging box", session: "s3" });
  put(db, "c", 2, "message", { text: "unrelated chatter" });

  const hits = searchMemories(db, "staging");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.kind, "message");
  assert.equal(hits[0]?.source.session, "s3");
});

test("a message without a session reports only the seq", () => {
  const db = freshDb();
  put(db, "c", 5, "message", { text: "the build is green" });

  const [hit] = searchMemories(db, "green");
  assert.equal(hit?.source.seq, 5);
  assert.equal(hit?.source.session, undefined);
});

test("rows outside memory and message are not knowledge", () => {
  const db = freshDb();
  put(db, "c", 1, "tool_result", { text: "neovim config written" });
  put(db, "c", 2, "memory", { text: "uses neovim" });

  const hits = searchMemories(db, "neovim");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.kind, "memory");
});

test("more matched words ranks higher than one repeated word", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "typescript typescript typescript", source: "s1" });
  put(db, "c", 2, "memory", { text: "typescript build with esbuild", source: "s1" });

  const hits = searchMemories(db, "typescript build");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.source.seq, 2);
  assert.ok(hits[0]!.score > hits[1]!.score);
});

test("repeats break a tie between equally broad matches", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "sqlite store", source: "s1" });
  put(db, "c", 2, "memory", { text: "sqlite store, sqlite everywhere", source: "s1" });

  const hits = searchMemories(db, "sqlite");
  assert.deepEqual(hits.map((hit) => hit.source.seq), [2, 1]);
});

test("a distilled memory outranks a message that matches equally well", () => {
  const db = freshDb();
  put(db, "c", 1, "message", { text: "prefers dark mode" });
  put(db, "c", 2, "memory", { text: "dark mode preferred", source: "s1" });

  const hits = searchMemories(db, "dark mode");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.kind, "memory", "the fact beats the chat line");
  assert.equal(hits[1]?.kind, "message");
  assert.equal(hits[0]!.score - hits[1]!.score, 5);
});

test("a restated fact is reported once, newest wins on an equal score", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "Works on Linux", source: "s1" });
  put(db, "c", 2, "memory", { text: "works on  LINUX", source: "s2" });

  const hits = searchMemories(db, "linux");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.source.seq, 2);
  assert.equal(hits[0]?.source.session, "s2");
});

test("a query with no match returns an empty list, not an error", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "uses neovim" });

  assert.deepEqual(searchMemories(db, "kubernetes"), []);
});

test("empty, whitespace and punctuation-only queries return nothing", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "uses neovim" });

  for (const query of ["", "   ", "!!!", "%%%_", "a", "-", "…"]) {
    assert.deepEqual(searchMemories(db, query), [], `query ${JSON.stringify(query)}`);
  }
});

test("SQL metacharacters in a query are data, not syntax", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "the store is sqlite" });

  const hits = searchMemories(db, "'; DROP TABLE events; --");
  // "drop" and "table" are words, neither is in the text; nothing is executed.
  assert.deepEqual(hits, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get()?.["n"], 1);
});

test("a query is split into words and lowercased", () => {
  assert.deepEqual(queryTerms("  Linux,   Neovim! "), ["linux", "neovim"]);
  assert.deepEqual(queryTerms("linux linux LINUX"), ["linux"]);
  assert.deepEqual(queryTerms(""), []);
  assert.deepEqual(queryTerms("!!!"), []);
  assert.equal(queryTerms("a").length, 0, "one-letter words are not words");
});

test("unicode words match regardless of case", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: "Woont in Groningen, drinkt café" });

  const hits = searchMemories(db, "CAFÉ");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.source.seq, 1);
});

test("limit caps the result and the best hit survives", () => {
  const db = freshDb();
  for (let seq = 1; seq <= 5; seq += 1) {
    put(db, "c", seq, "message", { text: `build number ${String(seq)}` });
  }
  put(db, "c", 6, "memory", { text: "build build build", source: "s1" });

  const hits = searchMemories(db, "build", 2);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.source.seq, 6);
});

test("the default limit is the documented one", () => {
  const db = freshDb();
  for (let seq = 1; seq <= DEFAULT_MEMORY_LIMIT + 5; seq += 1) {
    put(db, "c", seq, "message", { text: `ticket ${String(seq)}` });
  }
  assert.equal(searchMemories(db, "ticket").length, DEFAULT_MEMORY_LIMIT);
});

test("a nonsense limit is refused by name", () => {
  const db = freshDb();
  assert.throws(() => searchMemories(db, "linux", 0), RangeError);
  assert.throws(() => searchMemories(db, "linux", -3), RangeError);
  assert.throws(() => searchMemories(db, "linux", 1.5), RangeError);
});

test("a payload without text is skipped, not fatal", () => {
  const db = freshDb();
  put(db, "c", 1, "memory", { text: 42 });
  put(db, "c", 2, "memory", null);
  put(db, "c", 3, "memory", { note: "no text key" });
  put(db, "c", 4, "memory", { text: "  " });
  put(db, "c", 5, "memory", { text: "linux is the target" });

  const hits = searchMemories(db, "linux");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.source.seq, 5);
});

test("long text is shown as an excerpt around the match", () => {
  const padding = "filler ".repeat(200);
  const long = `${padding}the needle word ${padding}`;
  const hits = searchMemoryEvents([memory("c", 1, long)], "needle");

  assert.equal(hits.length, 1);
  const text = hits[0]!.text;
  assert.ok(text.length < long.length);
  assert.ok(text.includes("needle"));
  assert.ok(text.startsWith("…"));
});

test("short text is returned whole", () => {
  const hits = searchMemoryEvents([memory("c", 1, "short and sweet")], "sweet");
  assert.equal(hits[0]?.text, "short and sweet");
});

test("events from other chains keep their chain in the source", () => {
  const events = [memory("alpha", 3, "linux laptop"), message("beta", 9, "linux desktop")];
  const hits = searchMemoryEvents(events, "linux");

  assert.deepEqual(hits.map((hit) => hit.source.chain).sort(), ["alpha", "beta"]);
  assert.deepEqual(hits.map((hit) => hit.source.seq).sort(), [3, 9]);
});

test("a store handle and the raw table agree", () => {
  const store = EventStore.open(":memory:");
  try {
    store.append("c", { id: "a", node: "n", type: "memory", data: { text: "uses kitty", source: "s1" } });
    store.append("c", { id: "b", node: "n", type: "message", data: { text: "kitty theme", session: "s2" } });
    store.append("c", { id: "c", node: "n", type: "tool_result", data: { text: "kitty is a terminal" } });

    const hits = searchStoreMemories(store, "c", "kitty");
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((hit) => hit.source.seq).sort(), [1, 2]);
    assert.deepEqual(searchStoreMemories(store, "c", "!!!"), []);
  } finally {
    store.close();
  }
});

test("searching a chain with no events is empty, not an error", () => {
  const store = EventStore.open(":memory:");
  try {
    assert.deepEqual(searchStoreMemories(store, "nothing", "linux"), []);
  } finally {
    store.close();
  }
});
