import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { asToolDefs, connectMcpServer, flattenMcpContent, parseRpcBody } from "./client.js";
import type { McpServerConfig } from "../chain/gates.js";

test("flatten turns MCP content blocks into one readable text", () => {
  assert.equal(flattenMcpContent([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(flattenMcpContent("kale string"), "kale string");
  assert.equal(flattenMcpContent([{ type: "image", data: "x" }]), "");
});

test("parseRpcBody answers plain JSON and SSE streams alike", () => {
  assert.deepEqual(parseRpcBody('{"result":{"tools":[]}}'), { ok: true, result: { tools: [] } });
  assert.equal(parseRpcBody('{"error":{"message":"neen"}}').ok, false);
  const sse = 'event: message\r\ndata: {"result":{"ok":true}}\r\n\r\n';
  assert.deepEqual(parseRpcBody(sse), { ok: true, result: { ok: true } });
});

test("asToolDefs keeps named tools and drops broken ones", () => {
  const defs = asToolDefs({
    tools: [
      { name: "bewijs_tool", description: "doet iets", inputSchema: { type: "object", properties: {} } },
      { description: "geen naam" },
      "geen object",
    ],
  });
  assert.equal(defs.length, 1);
  assert.equal(defs[0]?.name, "bewijs_tool");
  assert.deepEqual(asToolDefs({}), []);
  assert.deepEqual(asToolDefs("geen"), []);
});

test("a real http handshake lists tools and a call flattens its result", async () => {
  let calls = 0;
  let lastArgs: unknown = null;
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      const frame = JSON.parse(body);
      calls += 1;
      if (frame["method"] === "initialize") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: frame["id"], result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }));
        return;
      }
      if (frame["method"] === "tools/list") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: frame["id"], result: { tools: [{ name: "hallo", description: "zegt hallo", inputSchema: { type: "object", properties: { naam: { type: "string" } }, required: ["naam"] } }] } })}\n\n`);
        return;
      }
      if (frame["method"] === "tools/call") {
        lastArgs = frame["params"];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: frame["id"], result: { content: [{ type: "text", text: "hallo terug" }] } }));
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  try {
    const config: McpServerConfig = {
      id: "mock",
      label: "Mockserver",
      transport: "http",
      url: `http://127.0.0.1:${String(port)}/mcp`,
      enabled: true,
    };
    const connection = await connectMcpServer(config);
    assert.equal(connection.tools.length, 1);
    const tool = connection.tools[0];
    assert.ok(tool !== undefined);
    assert.equal(tool.name, "hallo");
    assert.equal(await tool.run({ naam: "Roan" }, { cwd: "." }), "hallo terug");
    assert.ok(calls >= 3);
    const params = lastArgs as { name?: string; arguments?: { naam?: string } } | null;
    assert.equal(params?.name, "hallo");
    assert.equal(params?.arguments?.naam, "Roan");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a server that refuses the handshake fails honestly", async () => {
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      const frame = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: frame["id"], error: { code: -32000, message: "binnen verboden" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    await assert.rejects(
      connectMcpServer({ id: "x", label: "X", transport: "http", url: `http://127.0.0.1:${String(port)}/mcp`, enabled: true }),
      /handshake failed.*binnen verboden/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
