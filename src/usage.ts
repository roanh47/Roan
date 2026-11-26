/**
 * Token usage as the UI needs it: one shape for every provider, one readable
 * line, one running total.
 *
 * Providers report the same two numbers under three different names. This
 * module is the single place that knows those names, so a panel can normalise
 * a raw payload, format a line and add a session up without branching on the
 * vendor. Nothing here persists and nothing prints.
 */

/** Normalised token counts. */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

/** USD per million tokens, matching the catalog's `inputCost`/`outputCost`. */
export interface PricePerMillion {
  readonly input: number;
  readonly output: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A token count is a finite, non-negative number; anything else is absent. */
function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** The wire names for `(input, output)`, in the order families are tried. */
const COUNT_PAIRS: readonly (readonly [string, string])[] = Object.freeze([
  ["prompt_tokens", "completion_tokens"], // OpenAI
  ["input_tokens", "output_tokens"], // Anthropic
  ["promptTokenCount", "candidatesTokenCount"], // Google
]);

/** Reads one family's pair from a flat object; at least one side must exist. */
function readPair(record: Record<string, unknown>): TokenUsage | null {
  for (const [inputKey, outputKey] of COUNT_PAIRS) {
    const input = asCount(record[inputKey]);
    const output = asCount(record[outputKey]);
    if (input !== null || output !== null) {
      return { input: input ?? 0, output: output ?? 0 };
    }
  }
  return null;
}

/**
 * Normalises usage from an OpenAI, Anthropic or Google payload.
 *
 * Accepts the flat usage object and the common wrappers (`usage`,
 * `usageMetadata`, `tokenUsage`) so callers can hand in a whole response
 * chunk. Returns `null` when no recognised count is present; a missing side
 * of a recognised pair counts as zero.
 */
export function normalizeUsage(raw: unknown): TokenUsage | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const direct = readPair(record);
  if (direct !== null) return direct;

  for (const key of ["usage", "usageMetadata", "tokenUsage"]) {
    const nested = asRecord(record[key]);
    if (nested === null) continue;
    const pair = readPair(nested);
    if (pair !== null) return pair;
  }
  return null;
}

/** `1234` -> `"1,234"`, locale-independent so every machine agrees. */
function groupThousands(value: number): string {
  const whole = Math.trunc(Math.abs(value));
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return value < 0 ? `-${digits}` : digits;
}

/** Cost for one usage at per-million prices, in USD. Not rounded. */
function costOf(usage: TokenUsage, price: PricePerMillion): number {
  const input = Number.isFinite(price.input) && price.input > 0 ? price.input : 0;
  const output = Number.isFinite(price.output) && price.output > 0 ? price.output : 0;
  return (usage.input / 1_000_000) * input + (usage.output / 1_000_000) * output;
}

/** Four decimals is the smallest unit a person can act on in a status line. */
function formatUsd(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 1e4) / 1e4;
  return `$${(rounded === 0 ? 0 : rounded).toFixed(4)}`;
}

/**
 * One status line: `"1,234 in · 567 out"`, with `" · $0.0081"` appended when a
 * per-million price is given. A `null` usage renders as `"no usage"` so the
 * caller never has to special-case the empty state.
 */
export function usageLine(usage: TokenUsage | null, price?: PricePerMillion): string {
  if (usage === null) return "no usage";

  const input = Number.isFinite(usage.input) && usage.input > 0 ? usage.input : 0;
  const output = Number.isFinite(usage.output) && usage.output > 0 ? usage.output : 0;
  const line = `${groupThousands(input)} in · ${groupThousands(output)} out`;

  if (price === undefined) return line;
  return `${line} · ${formatUsd(costOf({ input, output }, price))}`;
}

/**
 * Sums a session's usages, ignoring `null`/`undefined` entries and
 * non-finite counts. An empty session totals zero.
 */
export function sessionTotal(
  usages: Iterable<TokenUsage | null | undefined>,
): TokenUsage {
  let input = 0;
  let output = 0;

  for (const usage of usages) {
    if (usage === null || usage === undefined) continue;
    if (Number.isFinite(usage.input) && usage.input > 0) input += usage.input;
    if (Number.isFinite(usage.output) && usage.output > 0) output += usage.output;
  }

  return { input, output };
}
