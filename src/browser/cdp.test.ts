import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeCdpFault, startFakeCdp, wait, type FakeCdpRequest, type FakeCdpServer } from "../testing/fake-cdp.js";
import { connect, type CdpClient } from "./cdp.js";

function must<T>(value: T | undefined, what: string): T {
  assert.notEqual(value, undefined, `expected ${what}`);
  return value as T;
}

function messageOf(error: unknown): string {
  assert.equal(error instanceof Error, true, `expected an Error, got ${String(error)}`);
  return (error as Error).message;
}

async function withServer(run: (server: FakeCdpServer) => Promise<void>): Promise<void> {
  const server = await startFakeCdp();
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

function request(server: FakeCdpServer, method: string): FakeCdpRequest {
  return must(server.lastRequest(method), `a ${method} request`);
}

describe("cdp connect", () => {
  it("rejects anything that is not a websocket url", async () => {
    await assert.rejects(connect("http://127.0.0.1:9222/json"), /cdp: not a websocket url: "http:\/\/127\.0\.0\.1:9222\/json"/);
    await assert.rejects(connect(""), /not a websocket url/);
  });

  it("fails with the url when nothing is listening", async () => {
    const error = await connect("ws://127.0.0.1:1/devtools/page/none", { connectTimeoutMs: 400 }).then(
      () => null,
      (reason: unknown) => reason,
    );
    const text = messageOf(error);
    assert.equal(text.startsWith("cdp: "), true, text);
    assert.equal(text.includes("ws://127.0.0.1:1/devtools/page/none"), true, text);
  });
});

describe("cdp send", () => {
  it("correlates an answer with its own id, whatever order answers arrive in", async () => {
    await withServer(async (server) => {
      server.handle("Slow.echo", async (params) => {
        await wait(40);
        return { mark: "slow", value: params["value"] };
      });
      server.handle("Fast.echo", (params) => ({ mark: "fast", value: params["value"] }));
      const client = await connect(server.url, { timeoutMs: 2_000 });
      try {
        const [slow, fast] = await Promise.all([
          client.send("Slow.echo", { value: 1 }),
          client.send("Fast.echo", { value: 2 }),
        ]);
        assert.deepEqual(slow, { mark: "slow", value: 1 });
        assert.deepEqual(fast, { mark: "fast", value: 2 });
        const slowId = must(request(server, "Slow.echo").id, "an id on the slow request");
        const fastId = must(request(server, "Fast.echo").id, "an id on the fast request");
        assert.notEqual(slowId, fastId);
        assert.deepEqual(request(server, "Slow.echo").params, { value: 1 });
      } finally {
        client.close();
      }
    });
  });

  it("passes a session id through when one is given", async () => {
    await withServer(async (server) => {
      server.handle("Runtime.evaluate", () => ({ result: { type: "string", value: "ok" } }));
      const client = await connect(server.url);
      try {
        await client.send("Runtime.evaluate", { expression: "1" }, "session-7");
        assert.equal(request(server, "Runtime.evaluate").sessionId, "session-7");
      } finally {
        client.close();
      }
    });
  });

  it("times out with the method name and the wait", async () => {
    await withServer(async (server) => {
      server.ignore("Never.answer");
      const client = await connect(server.url, { timeoutMs: 60 });
      try {
        const error = await client.send("Never.answer", {}).then(() => null, (reason: unknown) => reason);
        assert.equal(messageOf(error), "cdp: Never.answer timed out after 60ms");
        assert.equal(client.closed, false, "a timeout must not close the socket");
      } finally {
        client.close();
      }
    });
  });

  it("turns a protocol error into a message naming the method and code", async () => {
    await withServer(async (server) => {
      server.handle("Runtime.evaluate", () => {
        throw new FakeCdpFault(-32602, "Invalid parameters");
      });
      const client = await connect(server.url);
      try {
        await assert.rejects(
          client.send("Runtime.evaluate", { expression: "1" }),
          /cdp: Runtime\.evaluate failed: Invalid parameters \(code -32602\)/,
        );
      } finally {
        client.close();
      }
    });
  });

  it("reports a method the server does not know", async () => {
    await withServer(async (server) => {
      const client = await connect(server.url);
      try {
        await assert.rejects(client.send("Nope.call"), /cdp: Nope\.call failed: method not found: Nope\.call \(code -32601\)/);
      } finally {
        client.close();
      }
    });
  });

  it("rejects in-flight calls when the socket closes", async () => {
    await withServer(async (server) => {
      server.ignore("Runtime.evaluate");
      const client = await connect(server.url, { timeoutMs: 5_000 });
      const call = client.send("Runtime.evaluate", { expression: "1" });
      await wait(30);
      client.close();
      await assert.rejects(call, /cdp: connection closed before Runtime\.evaluate answered/);
      assert.equal(client.closed, true);
    });
  });

  it("refuses to send on a closed client instead of reconnecting", async () => {
    await withServer(async (server) => {
      server.handle("Runtime.evaluate", () => ({ result: { type: "number", value: 1 } }));
      const client = await connect(server.url);
      await client.send("Runtime.evaluate", { expression: "1" });
      client.close();
      await assert.rejects(client.send("Runtime.evaluate", { expression: "1" }), /cdp: socket is closed \(Runtime\.evaluate\)/);
      await wait(50);
      assert.equal(server.connections, 1, "a closed client must not open a second socket");
    });
  });
});

describe("cdp events", () => {
  it("delivers events by method and stops after unsubscribe", async () => {
    await withServer(async (server) => {
      const client: CdpClient = await connect(server.url);
      const seen: string[] = [];
      const unsubscribe = client.on("Page.loadEventFired", (params) => {
        seen.push(String(params["timestamp"] ?? "?"));
      });
      try {
        await server.connected();
        server.emit("Other.event", { ignored: true });
        server.emit("Page.loadEventFired", { timestamp: 1 });
        server.emit("Page.loadEventFired", { timestamp: 2 }, "session-1");
        await wait(40);
        unsubscribe();
        server.emit("Page.loadEventFired", { timestamp: 3 });
        await wait(40);
        assert.deepEqual(seen, ["1", "2"]);
      } finally {
        client.close();
      }
    });
  });

  it("announces the socket closing once", async () => {
    await withServer(async (server) => {
      const client = await connect(server.url);
      const reasons: string[] = [];
      client.on("close", (params) => {
        reasons.push(String(params["reason"]));
      });
      client.close();
      await wait(40);
      assert.equal(reasons.length, 1, reasons.join(","));
      assert.equal(reasons[0], "connection closed");
    });
  });
});
