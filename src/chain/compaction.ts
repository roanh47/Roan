/**
 * Long conversations stay affordable: past a window, the older half leaves the
 * request as a one-line-per-message digest and only the recent messages ride
 * along whole. Pure on injected input, so the cut is pinned by tests.
 */
export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface Compacted {
  /** One line per condensed message, or null when nothing was cut. */
  readonly digest: string | null;
  /** The messages that ride along whole, oldest first. */
  readonly recent: readonly ChatMessage[];
}

export function compactMessages(
  messages: readonly ChatMessage[],
  keep = 40,
  digestWidth = 80,
): Compacted {
  if (messages.length <= keep) return { digest: null, recent: messages };
  const cut = messages.length - keep;
  const digest = messages
    .slice(0, cut)
    .map((message) => {
      const flat = message.content.replace(/\s+/g, " ").trim();
      const line = flat.length > digestWidth ? `${flat.slice(0, digestWidth)}…` : flat;
      return `${message.role === "user" ? "owner" : "roan"}: ${line}`;
    })
    .join("\n");
  return { digest, recent: messages.slice(cut) };
}
