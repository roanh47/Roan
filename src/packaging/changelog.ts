/**
 * Parses a Keep a Changelog style markdown file into typed releases.
 *
 * The accepted shape is deliberately narrow:
 *
 * ```md
 * # Changelog            <- ignored, anything before the first release is ignored
 * ## [1.2.0] - 2026-02-01
 * ### Added
 * - a thing
 * ```
 *
 * A level-2 heading (`## ...`) is always read as a release heading. If it is
 * not exactly `## [<version>] - <YYYY-MM-DD>` the parser throws instead of
 * skipping it, because a changelog with a mis-typed release heading silently
 * loses a release.
 *
 * Order is preserved exactly as written: Keep a Changelog files are newest
 * first by convention, and re-sorting here would hide a file that is not.
 * Dates are treated as opaque `YYYY-MM-DD` strings, not as `Date` objects, so
 * no timezone can shift a release into the previous day.
 *
 * `Unreleased` is accepted as a version like any other; it still needs a date,
 * since the release shape is one shape.
 */

/** Section buckets Keep a Changelog defines, plus a fallback for anything else. */
export type SectionKind = "added" | "changed" | "fixed" | "removed" | "deprecated" | "security" | "other";

/** One release: its version, date and sections in document order. */
export interface ChangelogRelease {
  version: string;
  date: string;
  sections: { kind: SectionKind; entries: string[] }[];
}

/** `### Added` and friends, matched case-insensitively. */
const SECTION_KINDS: ReadonlyMap<string, SectionKind> = new Map([
  ["added", "added"],
  ["changed", "changed"],
  ["fixed", "fixed"],
  ["removed", "removed"],
  ["deprecated", "deprecated"],
  ["security", "security"],
]);

/** `## [1.2.3] - 2026-01-31`; the version is any non-empty bracket content. */
const RELEASE_PATTERN = /^##\s+\[([^\]\s][^\]]*)\]\s+-\s+(\d{4}-\d{2}-\d{2})$/;

/** A level-2 heading, but not a level-3 one. */
const LEVEL_TWO_HEADING = /^##(?!#)/;

/** A level-3 heading, captured without the hashes. */
const SECTION_PATTERN = /^###(?!#)\s+(.+)$/;

/** `- entry`; the marker is the only entry syntax accepted. */
const ENTRY_MARKER = "- ";

/** Trims one entry and drops the ones that are empty after trimming. */
function entryText(line: string): string | null {
  const text = line.trim().slice(ENTRY_MARKER.length).trim();
  return text.length === 0 ? null : text;
}

/**
 * Parses changelog markdown into releases, newest first as written.
 *
 * Text before the first release heading is ignored, as is any line inside a
 * release that is neither a section heading nor a `- ` entry (prose, blank
 * lines, continuation lines). Entries outside a section are ignored: a release
 * with loose bullets has no section to belong to.
 *
 * @throws Error when a `##` line is not a valid release heading; the message
 *   quotes the offending line.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  if (typeof markdown !== "string") {
    // Reachable from plain JS callers; the signature says string.
    throw new Error(`Invalid changelog: expected a string, got ${typeof markdown}`);
  }

  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | undefined;
  let currentSection: { kind: SectionKind; entries: string[] } | undefined;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (LEVEL_TWO_HEADING.test(line)) {
      const match = RELEASE_PATTERN.exec(line);
      if (match === null) {
        throw new Error(
          `Invalid changelog release heading: "${line}" — expected "## [<version>] - <YYYY-MM-DD>"`,
        );
      }
      const version = match[1];
      const date = match[2];
      if (version === undefined || date === undefined) {
        // Unreachable: the pattern has both groups.
        throw new Error(`Invalid changelog release heading: "${line}"`);
      }
      current = { version, date, sections: [] };
      releases.push(current);
      currentSection = undefined;
      continue;
    }

    if (current === undefined) {
      // Preamble before the first release heading: ignored.
      continue;
    }

    const sectionMatch = SECTION_PATTERN.exec(line);
    if (sectionMatch !== null) {
      const title = sectionMatch[1];
      if (title === undefined) {
        continue;
      }
      const kind = SECTION_KINDS.get(title.trim().toLowerCase()) ?? "other";
      currentSection = { kind, entries: [] };
      current.sections.push(currentSection);
      continue;
    }

    if (currentSection !== undefined && line.startsWith(ENTRY_MARKER)) {
      const text = entryText(line);
      if (text !== null) {
        currentSection.entries.push(text);
      }
    }
  }

  return releases;
}
