/**
 * Which tools a plan-mode turn may still see.
 *
 * The rule is deny-by-default: a tool counts as writing unless its name says
 * otherwise, because "we could not tell what it does" is not a reason to run it
 * while the user is only asking for a plan. That also covers the tools Roan did
 * not write — an MCP server, a plugin — where the name is all this layer knows.
 *
 * Everything here is pure and takes a tool list, so the gate can be tested
 * without a daemon, a store or a model.
 */

import type { Tool } from "../types.js";

/**
 * Verbs that only read. A tool whose first useful word is one of these stays
 * available in plan mode, including an MCP tool like
 * `mcp__brightspace__get_my_courses`.
 */
const READ_VERBS: ReadonlySet<string> = new Set([
  "read",
  "list",
  "search",
  "grep",
  "glob",
  "find",
  "get",
  "lookup",
  "view",
  "show",
  "query",
  "fetch",
  "inspect",
  "stat",
  "head",
  "tail",
  "cat",
  "describe",
  "history",
]);

/** Names that read by design, whatever their words suggest. */
const READ_ONLY_NAMES: ReadonlySet<string> = new Set(["skill_file", "read_file", "list_dir"]);

/**
 * Verbs that write, mutate or execute. A tool carrying one of these is never
 * offered in plan mode, even when another word in its name reads like a
 * reader ("get_and_delete" is a delete).
 */
const WRITE_VERBS: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "patch",
  "apply",
  "create",
  "delete",
  "remove",
  "rm",
  "mv",
  "cp",
  "move",
  "rename",
  "mkdir",
  "touch",
  "truncate",
  "append",
  "run",
  "exec",
  "execute",
  "shell",
  "bash",
  "sh",
  "spawn",
  "kill",
  "terminate",
  "install",
  "deploy",
  "push",
  "commit",
  "upload",
  "download",
  "save",
  "set",
  "update",
  "start",
  "stop",
  "restart",
  "chmod",
  "chown",
  "send",
  "post",
  "put",
  "generate",
  "delegate",
]);

/** `writeFile` and `do_somethingNow` become token lists rather than guesses. */
function tokensOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * True when a tool may run while plan mode is on: it reads and nothing else.
 *
 * The answer is deliberately conservative — an unknown tool is withheld, and
 * the transcript says why rather than the model silently losing a capability.
 */
export function isReadOnlyTool(name: string): boolean {
  const tokens = tokensOf(name);
  if (tokens.some((token) => WRITE_VERBS.has(token))) return false;
  if (READ_ONLY_NAMES.has(name.toLowerCase())) return true;
  return tokens.some((token) => READ_VERBS.has(token));
}

/** True when this tool has to stay away for the duration of the plan. */
export function isForbiddenInPlanMode(name: string): boolean {
  return !isReadOnlyTool(name);
}

/** The tools a plan-mode turn may still use, in their original order. */
export function planModeTools(tools: readonly Tool[], enabled: boolean): readonly Tool[] {
  if (!enabled) return tools;
  return tools.filter((tool) => isReadOnlyTool(tool.name));
}

/**
 * The tools plan mode takes away. A caller that wants to explain the mode — or
 * refuse a hallucinated call by name — uses this instead of the allowlist, so
 * the two can never drift apart.
 */
export function planModeForbidden(tools: readonly Tool[]): readonly Tool[] {
  return tools.filter((tool) => !isReadOnlyTool(tool.name));
}

/** What the transcript says when the model reaches for a withheld tool. */
export function planModeRefusal(toolName: string): string {
  return `plan mode is on: ${toolName} is not available until the plan is approved`;
}
