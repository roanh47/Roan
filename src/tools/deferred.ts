/**
 * Deferred tools: a tool that a model can see without paying for its schema.
 *
 * A big parameter schema is real context: every offer of `write_file`, `patch`
 * or an MCP tool repeats a few hundred tokens of JSON Schema the model usually
 * does not need. A deferred tool travels as `{ name, summary }` only; the full
 * `parameters` object is handed over when someone asks for it by name — the
 * turn runner's `tool_schema` step, a UI's detail pane, or a test.
 *
 * The registry is module-level because the model's view is process-wide: a tool
 * registered at import time is what `resolveSchema` knows about, exactly like
 * `toolSurface`. Definitions are frozen and names are unique, so two plugins
 * cannot silently shadow each other.
 */

import type { Tool, ToolContext } from "../types.js";

/** What a caller must provide to defer a tool. Same shape as `Tool`, plus a summary. */
export interface DeferredToolDefinition {
  readonly name: string;
  /** One line for the model: what it does and when to call it. */
  readonly summary: string;
  /** The long description; only sent once the schema is resolved. */
  readonly description?: string;
  /** The JSON Schema the model needs before it can call the tool. */
  readonly parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/**
 * The model-facing stub. Deliberately carries no `parameters` and no `run`:
 * what the model sees is exactly `{ name, summary }`.
 */
export interface DeferredTool {
  readonly name: string;
  readonly summary: string;
  /** Marks the tool as deferred so a spec builder knows to omit parameters. */
  readonly deferred: true;
}

/** The full schema, returned only by `resolveSchema`. */
export interface ResolvedToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * The model-facing short form, in the same wire shape `toToolSpecs` in
 * `src/tools.ts` uses (`{ type: "function", function: { … } }`), with
 * `parameters` absent on purpose: that is the whole point of deferring.
 */
export interface DeferredToolDescriptor {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
  };
}

const registry = new Map<string, DeferredToolDefinition & { readonly description: string }>();

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Registers a tool and returns its stub. The definition is frozen at this
 * point: a caller that mutates its object afterwards does not change what
 * `resolveSchema` answers.
 *
 * Throws on a missing name/summary/schema and on a name that is already
 * deferred — a duplicate would make `resolveSchema("x")` answer with whichever
 * one happened to register last.
 */
export function deferTool(definition: DeferredToolDefinition): DeferredTool {
  const name = typeof definition.name === "string" ? definition.name.trim() : "";
  if (name.length === 0) fail("a deferred tool needs a name");
  const summary = typeof definition.summary === "string" ? definition.summary.trim() : "";
  if (summary.length === 0) fail(`deferred tool "${name}" needs a summary`);
  if (typeof definition.parameters !== "object" || definition.parameters === null) {
    fail(`deferred tool "${name}" needs a parameters object`);
  }
  if (typeof definition.run !== "function") fail(`deferred tool "${name}" has no run()`);
  if (registry.has(name)) fail(`deferred tool "${name}" is already registered`);

  const frozen = Object.freeze({
    name,
    summary,
    description: definition.description ?? summary,
    // A shallow copy keeps the schema's top level from being swapped later;
    // nested objects are the caller's to keep honest, as everywhere else.
    parameters: Object.freeze({ ...definition.parameters }) as Record<string, unknown>,
    run: definition.run,
  });
  registry.set(name, frozen);
  return Object.freeze({ name, summary, deferred: true as const });
}

/**
 * The full schema for one deferred tool. This is the only way parameters leave
 * the registry; an unknown name throws instead of returning an empty schema,
 * so a typo in a request can never turn into "the model saw no parameters".
 */
export function resolveSchema(name: string): ResolvedToolSchema {
  const definition = registry.get(name);
  if (definition === undefined) {
    fail(`unknown deferred tool: "${name}" (deferred: ${listDeferred().map((tool) => tool.name).join(", ") || "none"})`);
  }
  return Object.freeze({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  });
}

/**
 * The runnable tool, schema included, for the moment a call actually arrives.
 * Same lookup and same honest failure as `resolveSchema`.
 */
export function resolveTool(name: string): Tool {
  const definition = registry.get(name);
  if (definition === undefined) fail(`unknown deferred tool: "${name}"`);
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    run: definition.run,
  };
}

/** True when a name has been deferred; the cheap pre-check before resolving. */
export function isDeferred(name: string): boolean {
  return registry.has(name);
}

/** Every deferred tool as the model sees it, in registration order. */
export function listDeferred(): DeferredTool[] {
  return [...registry.values()].map((definition) =>
    Object.freeze({ name: definition.name, summary: definition.summary, deferred: true as const }),
  );
}

/** The model-facing short form of one stub. Parameters stay hidden. */
export function toToolDescriptor(tool: DeferredTool): DeferredToolDescriptor {
  if (!registry.has(tool.name)) {
    fail(`unknown deferred tool: "${tool.name}"`);
  }
  return {
    type: "function",
    function: { name: tool.name, description: tool.summary },
  };
}

/**
 * Forgets every registration. Only tests need this: the real registry lives for
 * the life of the process and is filled at import time.
 */
export function resetDeferredTools(): void {
  registry.clear();
}
