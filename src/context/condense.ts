/**
 * Keeping a long conversation affordable without rewriting it every turn.
 *
 * Past a window, the older part of a conversation leaves the request and a
 * summary of it rides in its place. Two things matter about how:
 *
 *  - The boundary moves in steps, not with every message. A summary that
 *    changes each turn makes every request different from the last one and
 *    is paid for in full each time; one that holds still for twenty messages
 *    is written once and then costs nothing extra.
 *  - The summary is written by a model when one is available, and by a plain
 *    list when it is not, or when the model fails. A turn never waits on, or
 *    dies of, a summary.
 *
 * Everything here is pure except `condense`, which calls the function it is
 * handed.
 */

export interface PlainMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Messages a conversation may hold before the oldest are summarised. */
export const CONDENSE_WINDOW = 40;

/** How many messages the boundary moves at a time. */
export const CONDENSE_STEP = 20;

/** How much of one message the plain list and the summary request carry. */
const LINE_CHARS = 200;
const SOURCE_CHARS = 1200;

/**
 * Where a conversation is cut. With the defaults nothing is cut up to 40
 * messages; from there the older part grows by 20 at a time, so between 20
 * and 39 recent messages always ride along whole.
 */
export function splitForCondensing<T>(
  messages: readonly T[],
  window: number = CONDENSE_WINDOW,
  step: number = CONDENSE_STEP,
): { readonly older: T[]; readonly recent: T[] } {
  if (messages.length <= window || step < 1) return { older: [], recent: [...messages] };
  const cut = Math.floor((messages.length - (window - step)) / step) * step;
  return { older: messages.slice(0, cut), recent: messages.slice(cut) };
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The summary nobody had to think about: who said what, one line each. */
export function plainDigest(older: readonly PlainMessage[]): string {
  return older
    .map((message) => `- ${message.role === "user" ? "Owner" : "Roan"}: ${oneLine(message.content, LINE_CHARS)}`)
    .join("\n");
}

/** What the summarising model is asked. */
export function condensePrompt(older: readonly PlainMessage[]): string {
  const source = older
    .map((message) => `${message.role === "user" ? "OWNER" : "ROAN"}: ${oneLine(message.content, SOURCE_CHARS)}`)
    .join("\n\n");
  return [
    "Summarise the first part of a conversation between an owner and their agent, Roan, so Roan can continue it without that part.",
    "Keep, under these headings and nothing else:",
    "## Goal — what the owner is trying to get done.",
    "## Decisions — what was decided, and the owner's stated preferences and corrections.",
    "## Done — what was actually done, with file paths, commands and names exactly as written.",
    "## Open — what is unfinished or was asked and not answered.",
    "Be specific and short. Do not invent anything, do not address the owner, do not add advice.",
    "",
    "The conversation:",
    "",
    source,
  ].join("\n");
}

/**
 * The summary of the older part: the model's when there is one and it
 * answers with something, otherwise the plain list.
 */
export async function condense(
  older: readonly PlainMessage[],
  summarise?: (prompt: string) => Promise<string>,
): Promise<string> {
  if (older.length === 0) return "";
  if (summarise !== undefined) {
    try {
      const written = (await summarise(condensePrompt(older))).trim();
      if (written.length > 0) return written;
    } catch {
      // The plain list below is always a correct answer.
    }
  }
  return plainDigest(older);
}
