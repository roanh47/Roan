/**
 * Byte accounting for text that goes onto the wire.
 *
 * Event payloads carry a byte budget, not a character budget: an emoji costs
 * four bytes, a CJK ideograph three. `byteLength` answers what a string will
 * cost once encoded, `truncateForEvent` trims a string down to a budget without
 * ever cutting a character in half.
 */

/** Marker appended to a shortened string. */
export const ELLIPSIS = "…";

const ELLIPSIS_BYTES = 3;

export interface TruncatedText {
  /** The text that fits, or the original string when nothing had to go. */
  text: string;
  /** True when `text` is a shortened form of the input. */
  truncated: boolean;
  /** Size of the original input in UTF-8 bytes, before any cutting. */
  originalBytes: number;
}

/** UTF-8 length of a single code point, matching what `Buffer` does. */
function codePointBytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** Byte length of `text` once encoded as UTF-8. */
export function byteLength(text: string): number {
  if (typeof text !== "string") {
    throw new Error(`byteLength: expected a string, got ${typeof text}`);
  }
  return Buffer.byteLength(text, "utf8");
}

function invalidMaxBytes(maxBytes: number): Error {
  return new Error(
    `truncateForEvent: maxBytes must be a positive integer, got ${String(maxBytes)}`,
  );
}

/**
 * Fit `text` into `maxBytes` UTF-8 bytes.
 *
 * Text that already fits is returned untouched with `truncated: false`. Text
 * that does not is cut at a code point boundary — a surrogate pair is never
 * split — and gets a trailing `…`, which counts against the budget. A budget
 * too small to hold the marker (fewer than three bytes) yields an empty string
 * rather than a marker that would itself overflow.
 */
export function truncateForEvent(text: string, maxBytes: number): TruncatedText {
  if (typeof text !== "string") {
    throw new Error(
      `truncateForEvent: expected a string, got ${typeof text}`,
    );
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw invalidMaxBytes(maxBytes);
  }

  const originalBytes = Buffer.byteLength(text, "utf8");
  if (originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }

  const budget = maxBytes - ELLIPSIS_BYTES;
  if (budget < 1) {
    return { text: "", truncated: true, originalBytes };
  }

  let used = 0;
  let cut = "";
  // for...of walks code points, so a surrogate pair arrives as one unit and
  // can only ever be kept whole or dropped whole.
  for (const character of text) {
    const size = codePointBytes(character.codePointAt(0) ?? 0);
    if (used + size > budget) break;
    used += size;
    cut += character;
  }

  if (cut.length === 0) {
    // Nothing but the marker fits.
    return { text: ELLIPSIS, truncated: true, originalBytes };
  }
  return { text: `${cut}${ELLIPSIS}`, truncated: true, originalBytes };
}
