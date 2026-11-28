import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_WORKING_MINIS, MiniRegistry, finishedMinisNote, type MiniHandle } from "./mini-registry.js";

/** A piece of work the test finishes by hand. */
function manual() {
  let resolve: (summary: string) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  let handle: MiniHandle | null = null;
  const work = (given: MiniHandle): Promise<string> => {
    handle = given;
    return new Promise<string>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
  };
  return {
    work,
    finish: (summary: string) => resolve(summary),
    fail: (reason: string) => reject(new Error(reason)),
    handle: () => handle,
  };
}

describe("Mini Roan registry", () => {
  it("shows a run while it works, with what it is doing, then its summary", async () => {
    const registry = new MiniRegistry();
    const job = manual();
    const run = registry.start("  read the logs ", false, job.work);
    job.handle()?.note("read_file");
    job.handle()?.note("run_shell");
    assert.deepEqual(registry.list(), [
      { id: 1, task: "read the logs", status: "working", activity: ["read_file", "run_shell"], result: "", background: false },
    ]);
    job.finish("two errors found");
    assert.equal(await run.finished, "two errors found");
    assert.equal(registry.list()[0]?.status, "done");
    assert.equal(registry.list()[0]?.result, "two errors found");
  });

  it("tells a finished background run once, and never a waited-for one", async () => {
    const registry = new MiniRegistry();
    const waited = manual();
    const background = manual();
    const first = registry.start("waited", false, waited.work);
    const second = registry.start("in the background", true, background.work);
    assert.deepEqual(registry.takeFinished(), []);
    waited.finish("a");
    background.finish("b");
    await first.finished;
    await second.finished;
    const told = registry.takeFinished();
    assert.deepEqual(told.map((run) => run.task), ["in the background"]);
    assert.deepEqual(registry.takeFinished(), []);
    assert.match(finishedMinisNote(told), /Mini Roan 2 — done/);
    assert.match(finishedMinisNote(told), /Summary: b/);
    assert.equal(finishedMinisNote([]), "");
  });

  it("keeps a failure in the registry, and a background failure does not go unhandled", async () => {
    const registry = new MiniRegistry();
    const job = manual();
    const run = registry.start("break", true, job.work);
    job.fail("provider down");
    await assert.rejects(run.finished, /provider down/);
    assert.equal(registry.list()[0]?.status, "failed");
    assert.match(finishedMinisNote(registry.takeFinished()), /Reason: provider down/);
  });

  it("stops a working run through its signal, and does not report it as news", () => {
    const registry = new MiniRegistry();
    const job = manual();
    registry.start("long", true, job.work);
    assert.equal(job.handle()?.signal.aborted, false);
    assert.equal(registry.stop(1).status, "stopped");
    assert.equal(job.handle()?.signal.aborted, true);
    assert.deepEqual(registry.takeFinished(), []);
    assert.throws(() => registry.stop(9), /no Mini Roan 9/);
  });

  it("refuses one more than may work at once", () => {
    const registry = new MiniRegistry();
    for (let index = 0; index < MAX_WORKING_MINIS; index += 1) registry.start(`task ${String(index)}`, true, manual().work);
    assert.throws(() => registry.start("one more", true, manual().work), /already working/);
  });
});
