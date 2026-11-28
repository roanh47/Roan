import type { ChatMessage } from "../types.js";

/**
 * Clearing old tool results inside a running turn.
 *
 * A long turn re-sends every tool result with every request. The model
 * rarely needs the full output of something it read twenty steps ago; it
 * needs to know it was read. So once the tool results of a turn grow past a
 * budget, the oldest ones are replaced by a one-line note. The newest rounds
 * are never touched, no model is asked, and the roles and call ids stay as
 * they are, so the transcript is still one a provider accepts.
 *
 * Clearing changes earlier messages and therefore costs the prompt cache
 * once. That is why it only happens past the budget, and then clears enough
 * to stay under it for a while instead of a little on every request.
 */

/** Tool output a turn may carry before the oldest is cleared. */
export const TOOL_RESULT_BUDGET_CHARS = 120_000;

/** Tool results at the end of the transcript that are always kept whole. */
export const TOOL_RESULTS_KEPT = 6;

/** A result shorter than this is not worth clearing. */
const SMALL_RESULT_CHARS = 400;

const CLEARED = /^\[tool output cleared to save context: \d+ characters\]$/;

function note(length: number): string {
  return `[tool output cleared to save context: ${String(length)} characters]`;
}

export interface ToolClearingOptions {
  readonly budgetChars?: number;
  readonly keep?: number;
}

/**
 * A copy of `messages` with old tool results cleared, or `null` when the
 * turn is under its budget or nothing old enough is left to clear.
 */
export function clearOldToolResults(
  messages: readonly ChatMessage[],
  options: ToolClearingOptions = {},
): ChatMessage[] | null {
  const budget = options.budgetChars ?? TOOL_RESULT_BUDGET_CHARS;
  const keep = options.keep ?? TOOL_RESULTS_KEPT;

  const toolIndexes: number[] = [];
  let total = 0;
  messages.forEach((message, index) => {
    if (message.role !== "tool" || typeof message.content !== "string") return;
    toolIndexes.push(index);
    total += message.content.length;
  });
  if (total <= budget) return null;

  const clearable = toolIndexes.slice(0, Math.max(0, toolIndexes.length - keep));
  const out = [...messages];
  let changed = false;
  // Oldest first, down to half the budget, so the next clearing is far away.
  for (const index of clearable) {
    if (total <= budget / 2) break;
    const message = out[index];
    if (message === undefined || typeof message.content !== "string") continue;
    const length = message.content.length;
    if (length < SMALL_RESULT_CHARS || CLEARED.test(message.content)) continue;
    const replacement = note(length);
    out[index] = { ...message, content: replacement };
    total -= length - replacement.length;
    changed = true;
  }
  return changed ? out : null;
}
