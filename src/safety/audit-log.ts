/**
 * An append-only trail of the tool decisions that were made elsewhere.
 *
 * The log is a record, not an arbiter: it never decides whether a call is
 * allowed, it remembers what somebody else decided so the choice can be
 * reviewed afterwards. It lives in memory, keeps only the most recent entries
 * and stamps each one with a sequence number, so the trail stays ordered
 * without depending on a clock.
 */

/** The three verdicts a tool call can carry. */
export type AuditDecision = "allow" | "ask" | "deny";

/** What a caller hands to `record`. */
export interface AuditEntryInput {
  /** Tool that was called, e.g. `read_file`. */
  tool: string;
  /** Verdict that was reached for the call. */
  decision: AuditDecision;
  /** Filesystem paths the call touched, in the order they were considered. */
  paths: readonly string[];
  /** Human-readable justification for the verdict. */
  reason: string;
}

/** A stored entry, stamped by the log and frozen. */
export interface AuditEntry {
  /** Monotonic sequence number, starting at 1. */
  readonly seq: number;
  readonly tool: string;
  readonly decision: AuditDecision;
  readonly paths: readonly string[];
  readonly reason: string;
}

/** Options for `createAuditLog`. */
export interface AuditLogOptions {
  /** How many entries to keep; older entries fall off the front. */
  capacity: number;
}

/** The handle returned by `createAuditLog`. */
export interface AuditLog {
  /** Store one decision and return the stamped, frozen entry. */
  record(entry: AuditEntryInput): AuditEntry;
  /** Deeply frozen copy of the retained entries, oldest first. */
  list(): readonly AuditEntry[];
  /** One compact single-line string per retained entry, oldest first. */
  toLines(): string[];
  /** How many entries are currently retained. */
  size(): number;
}

/** Characters that would break the one-line-per-entry promise of `toLines`. */
const LINE_BREAKS = /[\r\n\u2028\u2029]+/gu;

function invalidCapacity(capacity: number): Error {
  return new Error(
    `createAuditLog: capacity must be a positive safe integer, got ${String(capacity)}`,
  );
}

function isDecision(value: unknown): value is AuditDecision {
  return value === "allow" || value === "ask" || value === "deny";
}

/** Render an offending value for an error message without trusting its shape. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
}

/** Collapse line breaks so one entry can never become two lines. */
function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ");
}

/** Check the parts a caller could get wrong, naming whatever was wrong. */
function validateEntry(input: AuditEntryInput): {
  tool: string;
  decision: AuditDecision;
  paths: readonly string[];
  reason: string;
} {
  const { tool, decision, paths, reason } = input;

  if (typeof tool !== "string" || tool.trim().length === 0) {
    throw new Error(
      `record: tool must be a non-empty string, got ${describeValue(tool)}`,
    );
  }
  if (!isDecision(decision)) {
    throw new Error(
      `record: decision must be "allow", "ask" or "deny", got ${describeValue(decision)}`,
    );
  }
  if (!Array.isArray(paths)) {
    throw new Error(
      `record: paths must be an array, got ${describeValue(paths)}`,
    );
  }

  // `reason` has no stated throw case: absent text is logged as empty rather
  // than making a recorded decision unrecordable.
  return {
    tool,
    decision,
    paths,
    reason: typeof reason === "string" ? reason : "",
  };
}

/** Freeze an entry and its path list so no caller can change stored history. */
function freezeEntry(
  seq: number,
  tool: string,
  decision: AuditDecision,
  paths: readonly string[],
  reason: string,
): AuditEntry {
  return Object.freeze({
    seq,
    tool,
    decision,
    paths: Object.freeze([...paths]),
    reason,
  });
}

/** Independent frozen copy of a stored entry. */
function copyEntry(entry: AuditEntry): AuditEntry {
  return freezeEntry(entry.seq, entry.tool, entry.decision, entry.paths, entry.reason);
}

/** Format one entry as a compact, newline-free line. */
function formatEntry(entry: AuditEntry): string {
  const paths = entry.paths.map((path) => oneLine(path)).join(", ");
  return oneLine(
    `#${entry.seq} tool=${entry.tool} decision=${entry.decision} paths=[${paths}] reason=${entry.reason}`,
  );
}

/**
 * Create an in-memory audit log holding at most `capacity` entries.
 *
 * Recording past the capacity drops the oldest entries; sequence numbers keep
 * counting, so a gap at the front is how eviction shows itself.
 */
export function createAuditLog(options: AuditLogOptions): AuditLog {
  const { capacity } = options;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw invalidCapacity(capacity);
  }

  const entries: AuditEntry[] = [];
  let nextSeq = 1;

  function record(input: AuditEntryInput): AuditEntry {
    const valid = validateEntry(input);
    const entry = freezeEntry(
      nextSeq,
      valid.tool,
      valid.decision,
      valid.paths,
      valid.reason,
    );
    nextSeq += 1;

    entries.push(entry);
    if (entries.length > capacity) {
      entries.splice(0, entries.length - capacity);
    }

    return copyEntry(entry);
  }

  function list(): readonly AuditEntry[] {
    return Object.freeze(entries.map(copyEntry));
  }

  function toLines(): string[] {
    return entries.map(formatEntry);
  }

  function size(): number {
    return entries.length;
  }

  return { record, list, toLines, size };
}
