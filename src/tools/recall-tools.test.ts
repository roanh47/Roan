import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryHit } from "../knowledge/search.js";
import { createMemorySearchTool, createTodoTool } from "./recall-tools.js";
import { TodoStore } from "./todo.js";

const ctx = { cwd: "." };

describe("memory_search", () => {
  const hits: MemoryHit[] = [
    { text: "the server runs Debian", score: 15, kind: "memory", source: { chain: "c", seq: 4 } },
    { text: "deploy with the blue script", score: 10, kind: "message", source: { chain: "c", seq: 9, session: "abcdef123456" } },
  ];

  it("lists what was found and where", async () => {
    const asked: { query: string; limit: number }[] = [];
    const tool = createMemorySearchTool((query, limit) => {
      asked.push({ query, limit });
      return hits;
    });
    const out = await tool.run({ query: " deploy " }, ctx);
    assert.deepEqual(asked, [{ query: "deploy", limit: 8 }]);
    assert.equal(
      out,
      "- [memory] the server runs Debian\n- [message, conversation abcdef12] deploy with the blue script",
    );
  });

  it("caps the limit, says so when nothing matches, and refuses an empty query", async () => {
    const limits: number[] = [];
    const tool = createMemorySearchTool((_query, limit) => {
      limits.push(limit);
      return [];
    });
    assert.equal(await tool.run({ query: "x y", limit: 500 }, ctx), 'nothing found for "x y"');
    assert.deepEqual(limits, [25]);
    await assert.rejects(tool.run({ query: "  " }, ctx), /query is empty/);
  });
});

describe("todo", () => {
  it("adds, completes, removes and always answers with the whole list", async () => {
    const store = new TodoStore();
    const tool = createTodoTool(() => store);
    assert.equal(await tool.run({ action: "list" }, ctx), "the task list is empty");
    await tool.run({ action: "add", text: "read the code" }, ctx);
    await tool.run({ action: "add", text: "write the test" }, ctx);
    assert.equal(await tool.run({ action: "done", id: 1 }, ctx), "1. [x] read the code\n2. [ ] write the test");
    assert.equal(await tool.run({ action: "remove", id: "2" }, ctx), "1. [x] read the code");
  });

  it("refuses an unknown action, an empty task and a task that does not exist", async () => {
    const tool = createTodoTool(() => new TodoStore());
    await assert.rejects(tool.run({ action: "burn" }, ctx), /action must be/);
    await assert.rejects(tool.run({ action: "add", text: " " }, ctx), /must not be empty/);
    await assert.rejects(tool.run({ action: "done", id: 7 }, ctx), /unknown todo id/);
    await assert.rejects(tool.run({ action: "done" }, ctx), /id must be/);
  });

  it("keeps one list per conversation when the caller hands out one each", async () => {
    const lists = new Map<string, TodoStore>();
    let active = "a";
    const tool = createTodoTool(() => {
      const found = lists.get(active) ?? new TodoStore();
      lists.set(active, found);
      return found;
    });
    await tool.run({ action: "add", text: "only in a" }, ctx);
    active = "b";
    assert.equal(await tool.run({ action: "list" }, ctx), "the task list is empty");
  });
});
