/**
 * Effort levels and what they mean on the wire.
 *
 * A conversation carries one effort level (`low`, `normal`, `high`). This
 * module turns that level into the request fields the chosen provider family
 * understands, so no adapter and no caller has to know the vendor spelling.
 *
 * `normal` is deliberately the empty object: it is the provider's default, and
 * sending a "default" knob would only pin behaviour we did not ask for.
 * Unknown providers, models the catalog marks as non-reasoning, and malformed
 * arguments all yield `{}`; this function exists to be safe to call on every
 * turn and therefore never throws.
 */
import { protocolFor, type Protocol } from "./factory.js";
import { findModel } from "./lookup.js";

/** The three levels a conversation can run at. */
export type EffortLevel = "low" | "normal" | "high";

/** Every valid level, in increasing order. */
export const EFFORT_LEVELS: readonly EffortLevel[] = Object.freeze([
  "low",
  "normal",
  "high",
]);

/** Runtime guard: persisted settings may hold anything. */
export function isEffortLevel(value: unknown): value is EffortLevel {
  return value === "low" || value === "normal" || value === "high";
}

/**
 * Thinking budgets in tokens for the families that take a numeric budget.
 * Anthropic's minimum is 1024; 8192 leaves room to reason without dwarfing a
 * normal answer. Gemini accepts the same unit and order of magnitude.
 */
const BUDGET_TOKENS: Readonly<Record<"low" | "high", number>> = Object.freeze({
  low: 1024,
  high: 8192,
});

/**
 * Protocol names are accepted alongside catalog provider ids, so a caller that
 * already resolved the protocol does not have to look up a provider id.
 */
const PROTOCOL_ALIASES: Readonly<Record<string, Protocol>> = Object.freeze({
  "openai-compat": "openai-compat",
  "openai-compatible": "openai-compat",
  anthropic: "anthropic",
  google: "google",
  "google-vertex": "google",
  gemini: "google",
});

/** Provider id or protocol name -> protocol, without ever throwing. */
function protocolOf(provider: string): Protocol | null {
  const normalized = provider.trim().toLowerCase();
  const alias = PROTOCOL_ALIASES[normalized];
  if (alias !== undefined) return alias;
  return protocolFor(normalized);
}

/**
 * A catalog model that is explicitly non-reasoning must not receive a
 * reasoning knob: OpenAI rejects it and compat servers vary. An unknown model
 * is not blocked — proxies and local servers are often absent from the catalog
 * — so the provider family decides.
 */
function explicitlyNonReasoning(provider: string, model: string): boolean {
  return findModel(provider.trim().toLowerCase(), model)?.reasoning === false;
}

/**
 * Request fields for `level` on `provider`/`model`.
 *
 * - OpenAI-compatible: `reasoning_effort`
 * - Anthropic: `thinking` with a token budget
 * - Google: `generationConfig.thinkingConfig.thinkingBudget`
 *
 * Returns `{}` for `normal`, unknown providers, non-reasoning models, invalid
 * levels and any unexpected input. The result is a fresh object, so callers
 * may merge it into a request body without touching shared state.
 */
export function effortParams(
  provider: string,
  model: string,
  level: EffortLevel,
): Record<string, unknown> {
  try {
    if (!isEffortLevel(level) || level === "normal") return {};
    if (typeof provider !== "string" || typeof model !== "string") return {};

    const protocol = protocolOf(provider);
    if (protocol === null) return {};
    if (explicitlyNonReasoning(provider, model)) return {};

    const budget = BUDGET_TOKENS[level];

    switch (protocol) {
      case "openai-compat":
        return { reasoning_effort: level };
      case "anthropic":
        return { thinking: { type: "enabled", budget_tokens: budget } };
      case "google":
        return { generationConfig: { thinkingConfig: { thinkingBudget: budget } } };
    }
  } catch {
    // Effort is a preference, never a reason to fail a turn.
    return {};
  }
}
