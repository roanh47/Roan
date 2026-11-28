import type { ProviderConfig } from "../providers/adapter.js";

/**
 * Auxiliary models: a second model for a job the main one is wrong for.
 *
 * The main model answers the conversation. Some work around it does not need
 * that model, or cannot use it at all: a text-only model cannot look at a
 * photo, and distilling three facts from a finished chat does not deserve the
 * most expensive model in the list. Each such job is a slot, and a slot may
 * name its own model — on the provider in use, or on another saved one.
 *
 * - `vision`: looks at an attached image and describes it, so the main model
 *   gets the description as text. Without it the image goes to the main model.
 * - `background`: work nobody reads live, such as distilling memories.
 *
 * An empty slot always means "use the main model", so nothing changes until
 * the owner fills one in. Everything here is pure; the daemon does the calls.
 */

export const AUX_SLOTS = ["vision", "background"] as const;
export type AuxSlot = (typeof AUX_SLOTS)[number];

export interface AuxModel {
  /** A saved provider account id; empty means the provider in use. */
  readonly provider: string;
  readonly model: string;
}

export type AuxiliarySettings = { readonly [K in AuxSlot]: AuxModel | null };

export const NO_AUXILIARY: AuxiliarySettings = { vision: null, background: null };

export function isAuxSlot(value: unknown): value is AuxSlot {
  return value === "vision" || value === "background";
}

function parseModel(raw: unknown): AuxModel | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const model = typeof record["model"] === "string" ? record["model"].trim() : "";
  if (model.length === 0) return null;
  const provider = typeof record["provider"] === "string" ? record["provider"].trim() : "";
  return { provider, model };
}

/** Reads the `auxiliary` value of a config file; anything malformed is an empty slot. */
export function parseAuxiliary(raw: unknown): AuxiliarySettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return NO_AUXILIARY;
  const record = raw as Record<string, unknown>;
  return { vision: parseModel(record["vision"]), background: parseModel(record["background"]) };
}

/** One slot changed, the others kept. A model of "" empties the slot. */
export function withAuxModel(
  current: AuxiliarySettings,
  slot: AuxSlot,
  model: string,
  provider = "",
): AuxiliarySettings {
  const clean = model.trim();
  return { ...current, [slot]: clean.length === 0 ? null : { provider: provider.trim(), model: clean } };
}

/** The part of a saved provider account a request needs. */
export interface AuxAccount {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/**
 * How to reach the model of a slot, or `null` when the slot is empty or names
 * a provider that is not saved on this device — in both cases the caller uses
 * the main model, which is always a correct answer.
 */
export function resolveAux(
  auxiliary: AuxiliarySettings,
  slot: AuxSlot,
  main: ProviderConfig,
  accounts: readonly AuxAccount[],
): ProviderConfig | null {
  const wanted = auxiliary[slot];
  if (wanted === null) return null;
  if (wanted.provider.length === 0 || wanted.provider === main.providerId) {
    return { ...main, model: wanted.model };
  }
  const account = accounts.find((entry) => entry.id === wanted.provider);
  if (account === undefined) return null;
  return { baseUrl: account.baseUrl, apiKey: account.apiKey, model: wanted.model, providerId: account.id };
}

/** What the vision model is asked about an attached image. */
export function describeImagePrompt(question: string): string {
  return [
    "Describe this image for a colleague who cannot see it and has to answer a question about it.",
    "Be complete and literal: transcribe all text exactly, name what is shown, where it is, numbers, colours and anything unusual.",
    "Do not answer the question yourself and do not guess at what is not visible.",
    "",
    `The question they were asked: ${question.trim().length > 0 ? question.trim() : "(none, the image came alone)"}`,
  ].join("\n");
}

/** The owner's message with the description in place of the image. */
export function withImageDescription(text: string, description: string, model: string): string {
  return `${text}\n\n[An image was attached. You cannot see it; ${model} looked at it and describes it as follows.]\n${description.trim()}`;
}
