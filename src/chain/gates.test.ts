import assert from "node:assert/strict";
import { test } from "node:test";

import { approvedToolsFromEvents, mcpServersFromEvents, toolRulesFromEvents } from "./gates.js";
import type { Event, EventType } from "../protocol/types.js";

function event(seq: number, type: EventType, data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: 0, type, data };
}

test("mcp servers fold newest config per id", () => {
  const events = [
    event(1, "mcp_server", { id: "bewijs", label: "Bewijsserver", transport: "http", url: "http://127.0.0.1:9701/mcp" }),
    event(2, "mcp_server", { id: "tweede", transport: "stdio", command: "npx iets", enabled: false }),
    event(3, "mcp_server", { id: "bewijs", url: "http://127.0.0.1:9999/mcp", enabled: false }),
  ];
  const servers = mcpServersFromEvents(events);
  assert.equal(servers.length, 2);
  const bewijs = servers.find((server) => server.id === "bewijs");
  assert.ok(bewijs !== undefined);
  assert.equal(bewijs.url, "http://127.0.0.1:9999/mcp");
  assert.equal(bewijs.enabled, false);
  assert.equal(bewijs.label, "Bewijsserver");
  const tweede = servers.find((server) => server.id === "tweede");
  assert.ok(tweede !== undefined);
  assert.equal(tweede.transport, "stdio");
  assert.equal(tweede.command, "npx iets");
});

test("a removed server leaves the fold entirely", () => {
  const events = [
    event(1, "mcp_server", { id: "weg", label: "Weg", transport: "http", url: "http://127.0.0.1:1/mcp" }),
    event(2, "mcp_server", { id: "weg", removed: true }),
    event(3, "mcp_server", { id: "blijft", transport: "http", url: "http://127.0.0.1:2/mcp" }),
  ];
  const servers = mcpServersFromEvents(events);
  assert.equal(servers.length, 1);
  assert.equal(servers[0]?.id, "blijft");
});

test("malformed mcp events never enter the fold", () => {
  const events = [
    event(1, "mcp_server", "geen object"),
    event(2, "mcp_server", { label: "geen id" }),
    event(3, "mcp_server", { id: " ", label: "spatie-id" }),
    event(4, "message", { text: "geen server" }),
  ];
  assert.deepEqual(mcpServersFromEvents(events), []);
});

test("tool rules: newest wins, unmentioned tools stay default", () => {
  const events = [
    event(1, "tool_rule", { tool: "run_shell", enabled: false }),
    event(2, "tool_rule", { tool: "web_search", ask: true }),
    event(3, "tool_rule", { tool: "run_shell", enabled: true, ask: true }),
  ];
  const rules = toolRulesFromEvents(events);
  assert.deepEqual(rules.get("run_shell"), { enabled: true, ask: true });
  assert.deepEqual(rules.get("web_search"), { enabled: true, ask: true });
  assert.equal(rules.has("read_file"), false);
});

test("approvals: allow learns, reset forgets, deny answers nothing", () => {
  const events = [
    event(1, "tool_approval", { tool: "web_fetch", decision: "allow" }),
    event(2, "tool_approval", { tool: "web_fetch", decision: "deny" }),
    event(3, "tool_approval", { tool: "web_fetch", decision: "allow" }),
    event(4, "tool_approval", { tool: "web_fetch", decision: "reset" }),
    event(5, "tool_approval", { tool: "run_shell", decision: "allow" }),
    event(6, "tool_approval", { tool: "geen" }),
  ];
  const approved = approvedToolsFromEvents(events);
  assert.equal(approved.has("web_fetch"), false);
  assert.equal(approved.has("run_shell"), true);
  assert.equal(approved.size, 1);
});
