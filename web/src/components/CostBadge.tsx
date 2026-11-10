import type { ReactElement } from "react";

export interface CostBadgeProps {
  /** Prompt/context tokens consumed by the turn or session. */
  inputTokens: number;
  /** Completion tokens produced by the turn or session. */
  outputTokens: number;
  /** Known cost in US dollars, or null/undefined when the provider did not report one. */
  costUsd?: number | null;
  /** Render a single condensed line instead of labelled rows. */
  compact?: boolean;
}

const EM_DASH = "—";

const tokensFmt = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const dollarsFmt = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  currencyDisplay: "narrowSymbol",
});

/** Significant figures shown for amounts of a dollar or more. */
const WHOLE_DOLLAR_DIGITS = 2;

function formatTokens(count: number): string {
  return tokensFmt.format(Math.max(0, Math.trunc(count)));
}

/**
 * Formats a USD amount. Below one dollar the cents are fixed at two places;
 * at or above one dollar the major unit is rounded to two significant decimals
 * so large totals stay readable.
 */
function formatCost(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined || !Number.isFinite(costUsd)) {
    return EM_DASH;
  }
  const magnitude = Math.abs(costUsd);
  if (magnitude < 1) {
    return dollarsFmt.format(costUsd);
  }
  const compact = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: WHOLE_DOLLAR_DIGITS,
    maximumFractionDigits: WHOLE_DOLLAR_DIGITS,
    currencyDisplay: "narrowSymbol",
  });
  return compact.format(costUsd);
}

function hasCost(costUsd: number | null | undefined): boolean {
  return typeof costUsd === "number" && Number.isFinite(costUsd);
}

export default function CostBadge({
  inputTokens,
  outputTokens,
  costUsd,
  compact = false,
}: CostBadgeProps): ReactElement | null {
  const input = Math.max(0, Math.trunc(inputTokens));
  const output = Math.max(0, Math.trunc(outputTokens));
  const total = input + output;
  const known = hasCost(costUsd);

  if (total === 0 && !known) return null;

  const costText = formatCost(costUsd);

  if (compact) {
    return (
      <span
        className="costbadge costbadge--compact"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 6,
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--muted)",
          whiteSpace: "nowrap",
        }}
        title={`${formatTokens(input)} input tokens · ${formatTokens(output)} output tokens · ${costText}`}
      >
        <span>{`${formatTokens(total)} tok`}</span>
        <span aria-hidden="true" style={{ color: "var(--faint)" }}>
          ·
        </span>
        <span style={{ color: known ? "var(--accent)" : "var(--faint)" }}>{costText}</span>
      </span>
    );
  }

  return (
    <section
      className="costbadge"
      aria-label="Token usage and cost"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 10px",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--surface-2)",
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--muted)",
      }}
    >
      <span className="costbadge__row" style={{ display: "inline-flex", gap: 4 }}>
        <span style={{ color: "var(--faint)" }}>in</span>
        <span style={{ color: "var(--fg)" }}>{formatTokens(input)}</span>
      </span>
      <span className="costbadge__row" style={{ display: "inline-flex", gap: 4 }}>
        <span style={{ color: "var(--faint)" }}>out</span>
        <span style={{ color: "var(--fg)" }}>{formatTokens(output)}</span>
      </span>
      <span
        className="costbadge__row"
        style={{
          display: "inline-flex",
          gap: 4,
          paddingLeft: 10,
          borderLeft: "1px solid var(--line-soft)",
        }}
      >
        <span style={{ color: "var(--faint)" }}>cost</span>
        <span style={{ color: known ? "var(--accent)" : "var(--faint)" }}>{costText}</span>
      </span>
    </section>
  );
}
