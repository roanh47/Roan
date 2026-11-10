import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { assertConverged, syncBothWays, withTwoNodes, type TestNode } from "./two-node.js";

function seqs(node: TestNode): number[] {
  return node.store.all().map((event) => event.seq);
}

function ids(node: TestNode): string[] {
  return node.store.all().map((event) => event.id);
}

describe("two-node harness", () => {
  it("an append on A reaches B after a sync", async () => {
    await withTwoNodes(async (a, b) => {
      const event = await a.append("message", { text: "hallo" });

      assert.equal(a.head(), 1);
      assert.equal(b.head(), 0, "B must not see the event before the sync");

      await syncBothWays(a, b);

      assert.equal(b.head(), 1);
      assert.deepEqual(ids(b), [event.id]);
      assert.deepEqual(seqs(b), [1]);
      assertConverged(a, b);
    });
  });

  it("an append on B reaches A after a sync", async () => {
    await withTwoNodes(async (a, b) => {
      const event = await b.append("assistant", { text: "hoi" });

      assert.equal(a.head(), 0);
      await syncBothWays(a, b);

      assert.equal(a.head(), 1);
      assert.deepEqual(ids(a), [event.id]);
      assertConverged(a, b);
    });
  });

  it("concurrent appends converge to one ordered list with contiguous seqs", async () => {
    await withTwoNodes(async (a, b) => {
      const [fromA, fromB] = await Promise.all([
        a.append("message", { side: "a" }),
        b.append("message", { side: "b" }),
      ]);

      // Two passes: the second one must be a no-op, not a duplicate or a reorder.
      await syncBothWays(a, b);
      await syncBothWays(a, b);

      assert.equal(a.head(), 2);
      assert.equal(b.head(), 2);
      assert.deepEqual(seqs(a), [1, 2]);
      assert.deepEqual(seqs(b), [1, 2]);
      assert.deepEqual(ids(a), ids(b));
      assert.deepEqual(ids(a), [fromA.id, fromB.id]);
      assert.deepEqual(
        a.store.all().map((event) => event.node),
        ["a", "b"],
        "the gate must order the writes, one writer at a time",
      );
      assertConverged(a, b);
    });
  });

  it("assertConverged names the seq and ids when the chains diverge", async () => {
    await withTwoNodes(async (a, b) => {
      a.store.append({
        v: 1,
        chain: a.store.chain,
        seq: 1,
        id: "a-1",
        node: a.store.nodeId,
        ts: 1,
        type: "message",
        data: null,
      });
      b.store.append({
        v: 1,
        chain: b.store.chain,
        seq: 1,
        id: "b-1",
        node: b.store.nodeId,
        ts: 2,
        type: "message",
        data: null,
      });

      assert.throws(
        () => assertConverged(a, b),
        /did not converge at index 0: a has seq 1 id "a-1"/,
      );
      await assert.rejects(syncBothWays(a, b), /hard conflict on seq 1/);
    });
  });

  it("removes both temp directories afterwards", async () => {
    let dirs: string[] = [];
    await withTwoNodes(async (a, b) => {
      dirs = [a.dir, b.dir];
      assert.ok(existsSync(a.dir), "A's directory should exist while the callback runs");
      assert.ok(existsSync(b.dir), "B's directory should exist while the callback runs");
    });

    assert.equal(dirs.length, 2);
    for (const dir of dirs) {
      assert.equal(existsSync(dir), false, `temp directory ${dir} should be gone`);
    }
  });

  it("removes the temp directories when the callback throws", async () => {
    let dir = "";
    await assert.rejects(
      withTwoNodes(async (a) => {
        dir = a.dir;
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(existsSync(dir), false, "cleanup must survive a failing callback");
  });
});
