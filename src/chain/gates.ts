import type { Event } from "../protocol/types.js";

/** One MCP server the chain knows: every instance folds the same set. */
export interface McpServerConfig {
  readonly id: string;
  readonly label: string;
  readonly transport: "http" | "stdio";
  /** http: the JSON-RPC endpoint the daemon POSTs to. */
  readonly url?: string;
  /** stdio: the command the daemon spawns, arguments included. */
  readonly command?: string;
  readonly enabled: boolean;
}

/** Per-tool policy: off tools never reach the model, ask tools need a yes. */
export interface ToolRule {
  readonly enabled: boolean;
  readonly ask: boolean;
}

/** The default: every tool exists and runs without asking. */
export const OPEN_RULE: ToolRule = { enabled: true, ask: false };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * MCP servers from the chain, per-field newest wins. A disabled server stays
 * in the list — the app shows it and the daemon skips connecting.
 */
export function mcpServersFromEvents(events: readonly Event[]): McpServerConfig[] {
  const byId = new Map<string, McpServerConfig>();
  for (const event of events) {
    if (event.type !== "mcp_server") continue;
    const data = asRecord(event.data);
    const id = typeof data["id"] === "string" && data["id"].trim().length > 0 ? data["id"] : null;
    if (id === null) continue;
    // A delete is a tombstone, not a rewrite of history: the id leaves the
    // fold and every instance agrees it is gone.
    if (data["removed"] === true) {
      byId.delete(id);
      continue;
    }
    // Per-field merge, like tool rules: an update that only flips `enabled`
    // keeps the label and the address it already had.
    const previous = byId.get(id);
    const transport = data["transport"] === "stdio" ? "stdio" : data["transport"] === "http" ? "http" : previous?.transport ?? "http";
    byId.set(id, {
      id,
      label: stringOr(data["label"], previous?.label ?? id),
      transport,
      ...(typeof data["url"] === "string" && data["url"].length > 0
        ? { url: data["url"] }
        : previous?.url !== undefined
          ? { url: previous.url }
          : {}),
      ...(typeof data["command"] === "string" && data["command"].length > 0
        ? { command: data["command"] }
        : previous?.command !== undefined
          ? { command: previous.command }
          : {}),
      enabled: typeof data["enabled"] === "boolean" ? data["enabled"] : previous?.enabled ?? true,
    });
  }
  return [...byId.values()];
}

/**
 * Tool rules from the chain, newest per tool wins. Unmentioned tools keep the
 * default: on, no questions. This is what every instance folds, so a rule set
 * on the phone holds on the server too.
 */
export function toolRulesFromEvents(events: readonly Event[]): Map<string, ToolRule> {
  const rules = new Map<string, ToolRule>();
  for (const event of events) {
    if (event.type !== "tool_rule") continue;
    const data = asRecord(event.data);
    const tool = typeof data["tool"] === "string" && data["tool"].trim().length > 0 ? data["tool"] : null;
    if (tool === null) continue;
    const previous = rules.get(tool) ?? OPEN_RULE;
    rules.set(tool, {
      enabled: typeof data["enabled"] === "boolean" ? data["enabled"] : previous.enabled,
      ask: typeof data["ask"] === "boolean" ? data["ask"] : previous.ask,
    });
  }
  return rules;
}

/**
 * Learned approvals: an allow is remembered for the tool, a reset forgets it,
 * a deny only answers this one call. The fold reads the chain in order, so
 * every instance agrees on which tools no longer need to ask.
 */
export function approvedToolsFromEvents(events: readonly Event[]): Set<string> {
  const approved = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_approval") continue;
    const data = asRecord(event.data);
    const tool = typeof data["tool"] === "string" && data["tool"].trim().length > 0 ? data["tool"] : null;
    if (tool === null) continue;
    if (data["decision"] === "allow") approved.add(tool);
    else if (data["decision"] === "reset") approved.delete(tool);
    // deny: answers this call only, nothing learned either way
  }
  return approved;
}
