import assert from "node:assert/strict";
import { it } from "node:test";
import { join } from "node:path";
import { withTempDir } from "../testing/temp-dir.js";
import { exportChain, importChain } from "./export.js";
import { EventStore } from "./store.js";

const CHAIN = "gesprek";

it("stores and reads back device_grant and device_result", () => {
  const store = EventStore.open(":memory:");
  try {
    store.append(CHAIN, {
      id: "grant-1",
      node: "owner",
      ts: 1,
      type: "device_grant",
      data: { node: "laptop", enabled: true },
    });
    store.append(CHAIN, {
      id: "result-1",
      node: "laptop",
      ts: 2,
      type: "device_result",
      data: { node: "laptop", command: "uptime", accepted: true, output: "up 3 days" },
    });

    const events = store.read(CHAIN);
    assert.deepEqual(
      events.map((event) => [event.seq, event.type]),
      [
        [1, "device_grant"],
        [2, "device_result"],
      ],
    );
    assert.deepEqual(events[0]?.data, { node: "laptop", enabled: true });
    assert.deepEqual(events[1]?.data, {
      node: "laptop",
      command: "uptime",
      accepted: true,
      output: "up 3 days",
    });
  } finally {
    store.close();
  }
});

it("exports and imports device events without losing them", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "chain.jsonl");
    const source = EventStore.open(":memory:");
    try {
      source.append(CHAIN, {
        id: "grant-1",
        node: "owner",
        ts: 1,
        type: "device_grant",
        data: { node: "laptop", enabled: false },
      });
      source.append(CHAIN, {
        id: "result-1",
        node: "laptop",
        ts: 2,
        type: "device_result",
        data: { node: "laptop", command: "date", accepted: false, reason: "device control: the grant for that node is disabled" },
      });

      const written = exportChain(source, CHAIN, path);
      assert.equal(written.count, 2);
    } finally {
      source.close();
    }

    const target = EventStore.open(":memory:");
    try {
      const outcome = importChain(target, CHAIN, path);
      assert.deepEqual(outcome, { imported: 2, skipped: 0 });
      assert.deepEqual(
        target.read(CHAIN).map((event) => event.type),
        ["device_grant", "device_result"],
      );
    } finally {
      target.close();
    }
  }, "device-events-");
});
