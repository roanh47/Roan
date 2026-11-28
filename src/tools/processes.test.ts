import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  MAX_RUNNING_JOBS,
  ProcessRegistry,
  createProcessTool,
  finishedJobsNote,
  type ChildLike,
} from "./processes.js";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  onClose(listener: (code: number | null) => void): void {
    this.on("close", listener);
  }
  onError(listener: (error: Error) => void): void {
    this.on("error", listener);
  }
  kill(): void {
    this.killed = true;
    this.emit("close", null);
  }
}

function harness() {
  const children: FakeChild[] = [];
  const registry = new ProcessRegistry(() => {
    const child = new FakeChild();
    children.push(child);
    const like: ChildLike = child;
    return like;
  });
  return { children, registry, tool: createProcessTool(registry) };
}

const ctx = { cwd: "/work" };

describe("background processes", () => {
  it("starts a job, collects both streams and reports the exit once", async () => {
    const { children, registry, tool } = harness();
    assert.equal(await tool.run({ action: "start", command: " npm run dev " }, ctx), "started background job 1: npm run dev");
    children[0]?.stdout.emit("data", "listening\n");
    children[0]?.stderr.emit("data", Buffer.from("warning\n"));
    assert.equal(await tool.run({ action: "output", id: 1 }, ctx), "1. [running] npm run dev\nlistening\nwarning");
    assert.deepEqual(registry.takeFinished(), []);

    children[0]?.emit("close", 0);
    const finished = registry.takeFinished();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.status, "exited");
    assert.deepEqual(registry.takeFinished(), []);
    assert.match(finishedJobsNote(finished), /1\. \[exited, exit 0\] npm run dev/);
    assert.equal(finishedJobsNote([]), "");
  });

  it("marks a non-zero exit and a spawn error as failed", async () => {
    const { children, registry, tool } = harness();
    await tool.run({ action: "start", command: "make" }, ctx);
    await tool.run({ action: "start", command: "nope" }, ctx);
    children[0]?.emit("close", 2);
    children[1]?.emit("error", new Error("ENOENT"));
    assert.equal(await tool.run({ action: "list" }, ctx), "1. [failed, exit 2] make\n2. [failed] nope");
    assert.match(registry.get(2).output, /could not start: ENOENT/);
  });

  it("stops a job on request and does not report it as news", async () => {
    const { children, registry, tool } = harness();
    await tool.run({ action: "start", command: "sleep 100" }, ctx);
    assert.equal(await tool.run({ action: "stop", id: 1 }, ctx), "1. [stopped] sleep 100");
    assert.equal(children[0]?.killed, true);
    assert.deepEqual(registry.takeFinished(), []);
  });

  it("refuses an empty command, an unknown job and one job too many", async () => {
    const { tool } = harness();
    assert.equal(await tool.run({ action: "list" }, ctx), "no background jobs");
    await assert.rejects(tool.run({ action: "start", command: " " }, ctx), /empty command/);
    await assert.rejects(tool.run({ action: "output", id: 9 }, ctx), /no background job 9/);
    await assert.rejects(tool.run({ action: "dance" }, ctx), /action must be/);
    for (let index = 0; index < MAX_RUNNING_JOBS; index += 1) {
      await tool.run({ action: "start", command: `job ${String(index)}` }, ctx);
    }
    await assert.rejects(tool.run({ action: "start", command: "one more" }, ctx), /already running/);
  });
});
