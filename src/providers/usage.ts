/**
 * Running token totals per chain, kept in memory only.
 *
 * A "chain" is an opaque string chosen by the caller (typically one
 * conversation). Nothing here persists: the store dies with the process.
 * Callers are responsible for rendering these numbers; this module never
 * logs or prints.
 */
import type { Usage } from "./adapter.js";

/** Accumulated token totals for one chain. */
export interface ChainUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

interface ChainUsageRecord {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

const store = new Map<string, ChainUsageRecord>();

/** Copy of one record, so callers cannot mutate the store by reference. */
function snapshot(record: ChainUsageRecord): ChainUsage {
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    requests: record.requests,
  };
}

/** Non-finite counts would poison every later total, so they count as zero. */
function safeCount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Records one request against a chain. A `null` usage still counts the
 * request but adds no tokens.
 */
export function recordUsage(chainId: string, usage: Usage | null): void {
  const current = store.get(chainId);
  const next: ChainUsageRecord = current
    ? {
        inputTokens: current.inputTokens,
        outputTokens: current.outputTokens,
        requests: current.requests,
      }
    : { inputTokens: 0, outputTokens: 0, requests: 0 };

  next.requests += 1;
  if (usage !== null) {
    next.inputTokens += safeCount(usage.inputTokens);
    next.outputTokens += safeCount(usage.outputTokens);
  }

  store.set(chainId, next);
}

/** Totals for a chain; zeros for an unseen chain. Never throws. */
export function usageFor(chainId: string): ChainUsage {
  const record = store.get(chainId);
  if (!record) {
    return { inputTokens: 0, outputTokens: 0, requests: 0 };
  }
  return snapshot(record);
}

/** Forgets everything recorded for one chain. */
export function resetUsage(chainId: string): void {
  store.delete(chainId);
}

/**
 * Frozen snapshot of every chain. The outer record and each entry are
 * frozen copies, so mutating the result cannot reach the store.
 */
export function allUsage(): Readonly<Record<string, ChainUsage>> {
  const out: Record<string, ChainUsage> = {};
  for (const [chainId, record] of store) {
    out[chainId] = Object.freeze(snapshot(record));
  }
  return Object.freeze(out);
}

/** Rounds to 6 decimals and normalises negative zero. */
function roundUsd(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Estimated USD cost for a chain's tokens at the given prices per million
 * tokens, rounded to 6 decimals.
 */
export function estimatedCost(
  chainId: string,
  inputCostPerMTok: number,
  outputCostPerMTok: number,
): number {
  const { inputTokens, outputTokens } = usageFor(chainId);
  const inputUsd = (inputTokens / 1_000_000) * safeCount(inputCostPerMTok);
  const outputUsd = (outputTokens / 1_000_000) * safeCount(outputCostPerMTok);
  return roundUsd(inputUsd + outputUsd);
}
