/**
 * What to do when the provider says the request does not fit its window.
 *
 * Roan has no tokenizer and no per-model window to measure against, so the
 * provider is the authority: a context-length rejection is the only reliable
 * signal. The response is deterministic and cheap — trim the long strings that
 * every request re-sends, and try once more. No model call, no summary that
 * could itself fail. When nothing can shrink, the turn ends and says so
 * instead of sending the same request in a loop.
 */
import { ProviderError } from "../providers/adapter.js";
import type { ChatMessage } from "../types.js";

/** Characters kept per trimmed message; the tail explains what was cut. */
export const OVERFLOW_KEEP_CHARS = 400;

/** HTTP statuses that can carry a "too large" rejection. */
const OVERFLOW_STATUSES = new Set([400, 413]);

/** Provider wordings that mean the request, not the credentials, was wrong. */
const OVERFLOW_PATTERN =
  /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|payload too large|request too large|token limit|exceeds the maximum/i;

/**
 * True when this request failed because the conversation is bigger than the
 * window. Any other 400 (a bad tool schema, a revoked key) must keep its own
 * path: compressing history would hide the real cause.
 */
export function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.status !== null && !OVERFLOW_STATUSES.has(error.status)) return false;
  return OVERFLOW_PATTERN.test(error.message);
}

/**
 * A copy of `messages` with every long body trimmed to `keep` characters, or
 * `null` when nothing was long enough to change — the caller then knows a
 * retry would send the identical request and must not happen.
 *
 * Roles and tool-call ids are untouched: the shape the provider and
 * `assertAlternating` require survives, only the payload shrinks.
 */
export function compressForOverflow(
  messages: readonly ChatMessage[],
  keep: number = OVERFLOW_KEEP_CHARS,
): ChatMessage[] | null {
  let changed = false;
  const out = messages.map((message) => {
    if (message.role === "system") return message;
    if (typeof message.content !== "string") return message;
    if (message.content.length <= keep) return message;
    changed = true;
    const flat = message.content.replace(/\s+/g, " ").trim();
    const dropped = message.content.length - keep;
    return {
      ...message,
      content: `${flat.slice(0, keep)}… [${String(dropped)} characters trimmed to fit the window]`,
    };
  });
  return changed ? out : null;
}
