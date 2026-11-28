/**
 * The reasoning of one turn, collected from the fragments a provider streams.
 *
 * A turn is several requests, and each may think before it answers or calls a
 * tool. The fragments are joined as they come; the result is one text the
 * chain keeps as a `reasoning` event. It is capped, because a long thought is
 * worth reading from the start and a chain event is not a place for megabytes.
 */

export const THOUGHT_LIMIT = 20_000;

export interface Thought {
  add(fragment: string): void;
  /** The collected reasoning, or `null` when the provider streamed none. */
  text(): string | null;
}

export function createThought(limit: number = THOUGHT_LIMIT): Thought {
  let collected = "";
  let dropped = false;
  return {
    add(fragment: string): void {
      if (fragment.length === 0) return;
      const room = limit - collected.length;
      if (room <= 0) {
        dropped = true;
        return;
      }
      if (fragment.length > room) dropped = true;
      collected += fragment.slice(0, room);
    },
    text(): string | null {
      const trimmed = collected.trim();
      if (trimmed.length === 0) return null;
      return dropped ? `${trimmed}\n…(truncated)` : trimmed;
    },
  };
}
