import { listProviders, modelsFor } from "./lookup.js";
import type { Model } from "./types.js";

/**
 * Criteria used by the model picker. Every criterion is optional; an unset
 * (or explicitly `false`) criterion matches every model. Costs are USD per
 * 1M tokens, context is in tokens.
 */
export interface ModelFilter {
  /** Require `model.toolCall === true`. */
  readonly tools?: boolean;
  /** Require `model.attachment === true`. */
  readonly attachments?: boolean;
  /** Require `model.reasoning === true`. */
  readonly reasoning?: boolean;
  /** Require `model.context >= minContext`; models without a context window fail. */
  readonly minContext?: number;
  /** Require `model.inputCost <= maxInputCost`; models without an input cost fail. */
  readonly maxInputCost?: number;
  /** Require `model.outputCost <= maxOutputCost`; models without an output cost fail. */
  readonly maxOutputCost?: number;
  /** Drop models whose status is `deprecated` or `alpha`. */
  readonly excludeDeprecated?: boolean;
}

/** One model together with the provider it belongs to. */
export interface ProviderModel {
  readonly providerId: string;
  readonly model: Model;
}

/**
 * Locale-independent string comparison, matching `lookup.ts`, so ordering is
 * identical on every machine regardless of ICU/locale data.
 */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** A finite number, or `undefined` when the field is absent or unusable. */
function finiteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

const DEPRECATED_STATUSES: ReadonlySet<string> = new Set(["deprecated", "alpha"]);

/** True when `model` satisfies every criterion set on `filter`. */
export function matchesFilter(model: Model, filter: ModelFilter = {}): boolean {
  if (filter.tools === true && model.toolCall !== true) return false;
  if (filter.attachments === true && model.attachment !== true) return false;
  if (filter.reasoning === true && model.reasoning !== true) return false;

  if (filter.excludeDeprecated === true) {
    const status = model.status;
    if (status !== undefined && DEPRECATED_STATUSES.has(status)) return false;
  }

  const minContext = finiteOrUndefined(filter.minContext);
  if (minContext !== undefined) {
    const context = finiteOrUndefined(model.context);
    if (context === undefined || context < minContext) return false;
  }

  const maxInputCost = finiteOrUndefined(filter.maxInputCost);
  if (maxInputCost !== undefined) {
    const inputCost = finiteOrUndefined(model.inputCost);
    if (inputCost === undefined || inputCost > maxInputCost) return false;
  }

  const maxOutputCost = finiteOrUndefined(filter.maxOutputCost);
  if (maxOutputCost !== undefined) {
    const outputCost = finiteOrUndefined(model.outputCost);
    if (outputCost === undefined || outputCost > maxOutputCost) return false;
  }

  return true;
}

/**
 * Cheapest first. Unknown prices sort last. Ties fall back to output cost,
 * then to id, so the order is total and machine-independent.
 */
export function sortByPrice(models: readonly Model[]): readonly Model[] {
  return Object.freeze(
    [...models].sort((a, b) => {
      const aIn = finiteOrUndefined(a.inputCost) ?? Number.POSITIVE_INFINITY;
      const bIn = finiteOrUndefined(b.inputCost) ?? Number.POSITIVE_INFINITY;
      if (aIn !== bIn) return aIn < bIn ? -1 : 1;

      const aOut = finiteOrUndefined(a.outputCost) ?? Number.POSITIVE_INFINITY;
      const bOut = finiteOrUndefined(b.outputCost) ?? Number.POSITIVE_INFINITY;
      if (aOut !== bOut) return aOut < bOut ? -1 : 1;

      return compareIds(a.id, b.id);
    }),
  );
}

/** Largest context window first. Models without a context window sort last. */
export function sortByContext(models: readonly Model[]): readonly Model[] {
  return Object.freeze(
    [...models].sort((a, b) => {
      const aContext = finiteOrUndefined(a.context) ?? Number.NEGATIVE_INFINITY;
      const bContext = finiteOrUndefined(b.context) ?? Number.NEGATIVE_INFINITY;
      if (aContext !== bContext) return aContext > bContext ? -1 : 1;
      return compareIds(a.id, b.id);
    }),
  );
}

/**
 * Models of one provider that pass `filter`, sorted by id. Unknown providers
 * and duplicate ids yield an empty list or a single entry respectively.
 */
export function filterModels(
  providerId: string,
  filter: ModelFilter = {},
): readonly Model[] {
  const seen = new Set<string>();
  const result: Model[] = [];
  for (const model of modelsFor(providerId)) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    if (matchesFilter(model, filter)) result.push(model);
  }
  return Object.freeze(result.sort((a, b) => compareIds(a.id, b.id)));
}

/**
 * Every provider/model pair that passes `filter`, ordered by provider id then
 * model id, without duplicate (provider, model) pairs.
 */
export function filterCatalog(filter: ModelFilter = {}): readonly ProviderModel[] {
  const seen = new Set<string>();
  const result: ProviderModel[] = [];
  for (const provider of listProviders()) {
    const models = [...modelsFor(provider.id)].sort((a, b) => compareIds(a.id, b.id));
    for (const model of models) {
      const key = `${provider.id}\u0000${model.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (matchesFilter(model, filter)) result.push({ providerId: provider.id, model });
    }
  }
  return Object.freeze(result);
}
