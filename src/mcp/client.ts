import { spawn } from "node:child_process";
import type { McpServerConfig } from "../chain/gates.js";
import type { Tool } from "../types.js";

/**
 * A minimal, real MCP client. It speaks the wire protocol — JSON-RPC 2.0 over
 * POST for http servers, line-delimited JSON over stdio for local ones — and
 * turns `tools/list` into the same Tool shape the builtin loop already runs.
 *
 * Scope of this wave: initialize, tools/list, tools/call. Prompts and
 * resources are later waves; every server keeps working without them.
 */

const PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT_MS = 20_000;

/** JSON-RPC body for one request; the id is per-connection. */
function rpc(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
}

/** The answer of one JSON-RPC call, or the server's error text. */
export interface RpcAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/** Pulls one JSON value out of an SSE stream body, or parses plain JSON. */
export function parseRpcBody(body: string): RpcAnswer {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return asAnswer(JSON.parse(trimmed));
  // text/event-stream: the last data: line that parses wins.
  let last: RpcAnswer = { ok: false, error: "empty answer" };
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      last = asAnswer(JSON.parse(line.slice(5).trim()));
    } catch {
      /* keep the previous data line */
    }
  }
  return last;
}

function asAnswer(value: unknown): RpcAnswer {
  if (typeof value !== "object" || value === null) return { ok: false, error: "not an object" };
  const record = value as Record<string, unknown>;
  if (typeof record["error"] === "object" && record["error"] !== null) {
    const detail = record["error"] as Record<string, unknown>;
    return { ok: false, error: stringOr(detail["message"], "server error") };
  }
  if (record["result"] === undefined) return { ok: false, error: "no result" };
  return { ok: true, result: record["result"] };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** MCP tool content is blocks; the agent reads text, so the blocks flatten. */
export function flattenMcpContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (typeof block === "object" && block !== null) {
      const record = block as Record<string, unknown>;
      if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
      else if (typeof record["content"] === "string") parts.push(record["content"]);
    }
  }
  return parts.join("\n");
}

async function httpRpc(url: string, body: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
      signal: controller.signal,
    });
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** One live MCP connection: the tools it offers and how to call them. */
export interface McpConnection {
  readonly server: McpServerConfig;
  readonly tools: readonly Tool[];
}

export async function connectMcpServer(server: McpServerConfig): Promise<McpConnection> {
  const sender =
    server.transport === "http" && server.url !== undefined
      ? async (body: string) => httpRpc(server.url as string, body)
      : server.transport === "stdio" && server.command !== undefined
        ? await stdioSender(server.command)
        : null;
  if (sender === null) throw new Error(`${server.label}: no valid address or command`);

  const init = parseRpcBody(await sender(rpc(1, "initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "roan", version: "0.0.21" } })));
  if (!init.ok) throw new Error(`${server.label}: handshake failed — ${init.error ?? "no answer"}`);
  const list = parseRpcBody(await sender(rpc(2, "tools/list", {})));
  if (!list.ok) throw new Error(`${server.label}: tools/list failed — ${list.error ?? "no answer"}`);

  const definitions = asToolDefs(list.result);
  const tools: Tool[] = definitions.map((definition) => ({
    name: definition.name,
    description: stringOr(definition.description, `${server.label}: ${definition.name}`),
    parameters:
      typeof definition.inputSchema === "object" && definition.inputSchema !== null
        ? (definition.inputSchema as Tool["parameters"])
        : { type: "object", properties: {} },
    async run(args) {
      const answer = parseRpcBody(await sender(rpc(3, "tools/call", { name: definition.name, arguments: args })));
      if (!answer.ok) throw new Error(answer.error ?? "tools/call failed");
      const record = typeof answer.result === "object" && answer.result !== null ? (answer.result as Record<string, unknown>) : {};
      if (record["isError"] === true) throw new Error(flattenMcpContent(record["content"]));
      return flattenMcpContent(record["content"]) || "(empty result)";
    },
  }));
  return { server, tools };
}

/** A tool definition as the server told it: name, description, inputSchema. */
export interface McpToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export function asToolDefs(result: unknown): McpToolDef[] {
  if (typeof result !== "object" || result === null) return [];
  const tools = (result as Record<string, unknown>)["tools"];
  if (!Array.isArray(tools)) return [];
  const defs: McpToolDef[] = [];
  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null) continue;
    const record = tool as Record<string, unknown>;
    if (typeof record["name"] !== "string" || record["name"].length === 0) continue;
    defs.push({
      name: record["name"],
      ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
      ...( "inputSchema" in record ? { inputSchema: record["inputSchema"] } : {}),
    });
  }
  return defs;
}

/** stdio: one long-lived child; every send writes a line and waits for one. */
async function stdioSender(command: string): Promise<(body: string) => Promise<string>> {
  const child = spawn(command, { shell: "/bin/bash", stdio: ["pipe", "pipe", "ignore"] });
  let buffer = "";
  let waiter: ((line: string) => void) | null = null;
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline >= 0 && waiter !== null) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const resolve = waiter;
      waiter = null;
      resolve(line);
    }
  });
  const exited = new Promise<never>((_, reject) => {
    child.on("exit", (code) => reject(new Error(`stdio server exited (exit ${String(code)})`)));
  });
  return async (body: string) => {
    child.stdin.write(`${body}\n`);
    const line = await new Promise<string>((resolve) => {
      waiter = resolve;
      setTimeout(() => {
        if (waiter === resolve) {
          waiter = null;
          resolve("");
        }
      }, CALL_TIMEOUT_MS);
    });
    if (line.length === 0) throw new Error("stdio server did not answer in time");
    return await Promise.race([Promise.resolve(line), exited]);
  };
}
