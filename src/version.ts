/**
 * The one place the product name and version live in TypeScript.
 *
 * VERSION must match `package.json` and `src-tauri/tauri.conf.json`. Those two
 * files are what npm and the Tauri bundler read, so a mismatch ships an app
 * that reports one version and installs as another. Bump all three together,
 * in the same commit.
 */

export const APP_NAME = "Roan";

export const VERSION = "0.1.0";

export type SemverOrdering = -1 | 0 | 1;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

const NUMERIC = /^(0|[1-9]\d*)$/;

function parse(input: string): ParsedVersion {
  const raw = input.trim().replace(/^v/, "");
  const plus = raw.indexOf("+");
  const withoutBuild = plus === -1 ? raw : raw.slice(0, plus);
  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash === -1 ? "" : withoutBuild.slice(dash + 1);

  const parts = core.split(".");
  if (parts.length !== 3) {
    throw new Error(`invalid version: ${JSON.stringify(input)}`);
  }

  const [majorText, minorText, patchText] = parts as [string, string, string];
  for (const part of [majorText, minorText, patchText]) {
    if (!NUMERIC.test(part)) {
      throw new Error(`invalid version: ${JSON.stringify(input)}`);
    }
  }

  const prerelease = pre === "" ? [] : pre.split(".");
  for (const identifier of prerelease) {
    if (identifier === "" || !/^[0-9A-Za-z-]+$/.test(identifier)) {
      throw new Error(`invalid version: ${JSON.stringify(input)}`);
    }
  }

  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    prerelease,
  };
}

function comparePrerelease(a: readonly string[], b: readonly string[]): SemverOrdering {
  // A release without a prerelease tag outranks any prerelease of it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    const leftNumeric = NUMERIC.test(left);
    const rightNumeric = NUMERIC.test(right);

    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;

    if (left !== right) return left < right ? -1 : 1;
  }

  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Compare two semantic versions.
 *
 * Returns -1 when `a` precedes `b`, 0 when they are equal, and 1 when `a`
 * follows `b` — the ordering `Array.prototype.sort` expects. Build metadata is
 * ignored, prereleases sort before their release, and malformed input throws
 * rather than silently comparing as equal.
 */
export function compare(a: string, b: string): SemverOrdering {
  const left = parse(a);
  const right = parse(b);

  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;

  return comparePrerelease(left.prerelease, right.prerelease);
}
