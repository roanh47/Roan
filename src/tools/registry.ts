import type { Tool } from "../types.js";
import type { Policy } from "./policy.js";

/**
 * A registry is the only place where the agent gets its tools from.
 *
 * - `all()`         all known tools, including the denied ones (for UI/inspection)
 * - `allowed()`     tools the agent may actually use
 * - `needsApproval()` tools for which the UI asks permission first
 * - `get()`/`has()` guarded lookup; a denied tool does not exist
 */
export interface ToolRegistry {
  all(): Tool[];
  allowed(): Tool[];
  needsApproval(): Tool[];
  get(name: string): Tool | undefined;
  has(name: string): boolean;
}

type Decision = "allow" | "ask" | "deny";

/** Reads the decision for one tool; anything that is not an explicit allow/ask is deny. */
function decide(policy: Policy, name: string): Decision {
  const entry = policy.tools[name];
  if (entry === "ask") return "ask";
  if (entry === "allow") return "allow";
  return "deny";
}

function assertUniqueNames(tools: readonly Tool[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }
  if (duplicates.size > 0) {
    throw new Error(`duplicate tool name(s): ${[...duplicates].join(", ")}`);
  }
}

function assertPolicyNamesKnown(policy: Policy, tools: readonly Tool[]): void {
  const known = new Set(tools.map((tool) => tool.name));
  const unknown = Object.keys(policy.tools ?? {}).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`policy names unknown tool(s): ${unknown.join(", ")}`);
  }
}

/**
 * The live surface: tools register themselves (core at import, plugins when
 * they load), the policy decides what the agent may use. Plugin tools default
 * to "allow" when the policy does not name them — installing a plugin is a
 * deliberate act; core tools stay deny-by-default, so the allowlist still
 * guards the shell.
 */
export class MutableToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, { tool: Tool; set: string; source: "core" | "plugin" }>();
  private generation = 0;

  constructor(private readonly policy: Policy) {}

  /** Registers a tool; a same-name registration replaces the old one (later wins). */
  register(tool: Tool, options: { set?: string; source?: "core" | "plugin" } = {}): void {
    const name = tool.name?.trim() ?? "";
    if (name.length === 0) throw new Error("a tool needs a name");
    if (typeof tool.run !== "function") throw new Error(`tool "${name}" has no run()`);
    this.tools.set(name, { tool, set: options.set ?? "core", source: options.source ?? "core" });
    this.generation += 1;
  }

  all(): Tool[] {
    return [...this.tools.values()].map((entry) => entry.tool);
  }

  allowed(): Tool[] {
    return [...this.tools.values()]
      .filter((entry) => this.decisionFor(entry.tool) !== "deny")
      .map((entry) => entry.tool);
  }

  needsApproval(): Tool[] {
    return [...this.tools.values()]
      .filter((entry) => this.decisionFor(entry.tool) === "ask")
      .map((entry) => entry.tool);
  }

  get(name: string): Tool | undefined {
    const entry = this.tools.get(name);
    if (entry === undefined) return undefined;
    return this.decisionFor(entry.tool) === "deny" ? undefined : entry.tool;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Bumps on every registration; consumers use it to invalidate caches. */
  registryGeneration(): number {
    return this.generation;
  }

  private decisionFor(tool: Tool): Decision {
    const entry = this.policy.tools[tool.name];
    // Only an explicit decision gates a tool here; the chain's tool_rule events
    // are the real per-turn gate. A registry with no policy allows everything.
    return entry === "allow" || entry === "ask" || entry === "deny" ? entry : "allow";
  }
}

export function buildRegistry(tools: Tool[], policy: Policy): ToolRegistry {
  assertUniqueNames(tools);
  assertPolicyNamesKnown(policy, tools);

  const byName = new Map<string, Tool>();
  const allowedNames = new Set<string>();
  const approvalNames = new Set<string>();

  for (const tool of tools) {
    byName.set(tool.name, tool);
    const decision = decide(policy, tool.name);
    if (decision === "deny") continue;
    // "ask" is also in allowed(): the agent may try it, the UI gates it.
    allowedNames.add(tool.name);
    if (decision === "ask") approvalNames.add(tool.name);
  }

  const lookup = (name: string): Tool | undefined =>
    allowedNames.has(name) ? byName.get(name) : undefined;

  return {
    all(): Tool[] {
      return tools.map((tool) => tool);
    },
    allowed(): Tool[] {
      return tools.filter((tool) => allowedNames.has(tool.name));
    },
    needsApproval(): Tool[] {
      return tools.filter((tool) => approvalNames.has(tool.name));
    },
    get(name: string): Tool | undefined {
      return lookup(name);
    },
    has(name: string): boolean {
      return lookup(name) !== undefined;
    },
  };
}
