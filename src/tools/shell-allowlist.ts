/**
 * Classification of a shell line before execution.
 *
 * The line is cut lexically into segments (on `&&`, `||`, `;`, newlines
 * and single `|`), each segment is checked against the rules and the
 * worst verdict wins: `deny` > `ask` > `allow`. Nothing is executed and
 * nothing is expanded; this is pure text.
 */

export type ShellVerdict = "allow" | "ask" | "deny";

export interface ShellDecision {
  verdict: ShellVerdict;
  /** Why this verdict was given. */
  reason: string;
  /** The piece of text the verdict applied to. */
  matched?: string;
}

export interface ShellRule {
  pattern: RegExp;
  verdict: ShellVerdict;
  reason: string;
}

/** Higher is stricter; for a chain the highest score wins. */
const SEVERITY: Record<ShellVerdict, number> = { allow: 0, ask: 1, deny: 2 };

/** Commands that only start the real command after themselves. */
const DOWNLOADERS: ReadonlySet<string> = new Set(["curl", "wget", "fetch", "aria2c", "http", "https"]);

/** Shells in which a download can be executed. */
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Paths outside of which nothing may be written. */
const SYSTEM_ROOTS = "(?:etc|usr|boot|dev)";

/** Prefixes that precede the actual command. */
const PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+|(?:sudo|doas|env|nohup|time|command|exec)\s+)/;

/**
 * Rules that only match the whole line, because their danger lies in the
 * combination of segments (a fork bomb splits itself on `;` and `|`).
 */
const WHOLE_LINE_RULES: readonly ShellRule[] = [
  {
    pattern: /:\s*\(\s*\)\s*\{[^}]*\}\s*;?\s*:/,
    verdict: "deny",
    reason: "fork bomb",
  },
];

/**
 * Default rules, in order: deny first, then allow, then ask.
 * The first matching rule determines the verdict for that segment.
 */
export const defaultRules: readonly ShellRule[] = [
  {
    pattern: /^rm\s+(?:-\S+\s+)+\/(?:\*)?(?:\s+-\S+)*\s*$/,
    verdict: "deny",
    reason: "recursive forced delete of the filesystem root",
  },
  {
    pattern: /^(?:sudo|doas)\b/,
    verdict: "deny",
    reason: "privilege escalation is never allowed",
  },
  {
    pattern: /^chmod\b.*\b777\b/,
    verdict: "deny",
    reason: "world-writable permissions",
  },
  {
    pattern: /^mkfs(?:\.[a-z0-9]+)?\b/,
    verdict: "deny",
    reason: "formatting a filesystem destroys data",
  },
  {
    pattern: /^dd\b.*\bof=\/dev\//,
    verdict: "deny",
    reason: "dd writing straight to a device node",
  },
  {
    pattern: /^(?:ba|z|da|k)?sh\s+-c\s+.*\b(?:curl|wget)\b/,
    verdict: "deny",
    reason: "runs a downloaded script through a shell",
  },
  {
    pattern: /^git\s+push\b.*(?:--force(?:-with-lease)?|(?:^|\s)-f(?:\s|$)).*\b(?:main|master|trunk|release|production|prod|stable)\b/,
    verdict: "deny",
    reason: "force push to a protected branch",
  },
  {
    pattern: /^git\s+push\b.*\b(?:main|master|trunk|release|production|prod|stable)\b.*(?:--force(?:-with-lease)?|(?:^|\s)-f(?:\s|$))/,
    verdict: "deny",
    reason: "force push to a protected branch",
  },
  {
    pattern: /^(?:>|>>)\s*\/etc\b/,
    verdict: "deny",
    reason: "redirects output into system configuration",
  },
  {
    pattern: new RegExp(`>{1,2}\\s*/${SYSTEM_ROOTS}\\b`),
    verdict: "deny",
    reason: "redirects output into a system directory outside the working directory",
  },
  {
    pattern: new RegExp(
      `^(?:cp|mv|install|ln|touch|mkdir|tee|truncate|chmod|chown|rm|dd|sed|perl)\\b.*\\s/${SYSTEM_ROOTS}\\b`,
    ),
    verdict: "deny",
    reason: "writes into a system directory outside the working directory",
  },

  {
    pattern: /^ls(?:\s|$)/,
    verdict: "allow",
    reason: "read-only listing",
  },
  {
    pattern: /^pwd\s*$/,
    verdict: "allow",
    reason: "read-only working directory",
  },
  {
    pattern: /^cat(?:\s|$)/,
    verdict: "allow",
    reason: "read-only file dump",
  },
  {
    pattern: /^head(?:\s|$)/,
    verdict: "allow",
    reason: "read-only file head",
  },
  {
    pattern: /^tail(?:\s|$)/,
    verdict: "allow",
    reason: "read-only file tail",
  },
  {
    pattern: /^wc(?:\s|$)/,
    verdict: "allow",
    reason: "read-only counting",
  },
  {
    pattern: /^git\s+status(?:\s|$)/,
    verdict: "allow",
    reason: "read-only git status",
  },
  {
    pattern: /^git\s+diff(?:\s|$)/,
    verdict: "allow",
    reason: "read-only git diff",
  },
  {
    pattern: /^git\s+log(?:\s|$)/,
    verdict: "allow",
    reason: "read-only git log",
  },
  {
    pattern: /^node\s+--version\s*$/,
    verdict: "allow",
    reason: "read-only node version",
  },
  {
    pattern: /^npm\s+run\s+typecheck(?:\s|$)/,
    verdict: "allow",
    reason: "type check of the workspace",
  },
  {
    pattern: /^npm\s+run\s+build(?:\s|$)/,
    verdict: "allow",
    reason: "build of the workspace",
  },
  {
    pattern: /^npm\s+test(?:\s|$)/,
    verdict: "allow",
    reason: "test run of the workspace",
  },

  {
    pattern: /^git\s+push\b/,
    verdict: "ask",
    reason: "pushing changes needs confirmation",
  },
  {
    pattern: /^git\s+(?:commit|checkout|switch|merge|rebase|reset|clean|stash|pull|fetch|tag)\b/,
    verdict: "ask",
    reason: "git changes the repository state",
  },
  {
    pattern: /^rm\b/,
    verdict: "ask",
    reason: "deleting files needs confirmation",
  },
  {
    pattern: /^(?:npm|pnpm|yarn)\s+(?:install|add|ci|publish|link)\b/,
    verdict: "ask",
    reason: "changes dependencies or publishes a package",
  },
];

interface RawSegment {
  text: string;
  /** Separator before this segment; empty for the first segment. */
  separator: string;
  /** True when the quote in this segment was not closed. */
  unterminated?: boolean;
}

/**
 * Lexical split that respects single and double quotes. Returns the
 * segments together with the separator that preceded them, so that a
 * pipeline can be recognised later. Empty segments are dropped.
 */
function splitRaw(command: string): RawSegment[] {
  const segments: RawSegment[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let separator = "";

  const flush = (next: string): void => {
    const text = current.trim();
    if (text !== "") segments.push({ text, separator });
    separator = next;
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);

    if (quote !== null) {
      current += char;
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        current += command.charAt(index);
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      current += char + command.charAt(index);
      continue;
    }
    if (char === ";" || char === "\n" || char === "\r") {
      flush(";");
      continue;
    }
    if (char === "&" && command.charAt(index + 1) === "&") {
      index += 1;
      flush("&&");
      continue;
    }
    if (char === "|") {
      if (command.charAt(index + 1) === "|") {
        index += 1;
        flush("||");
      } else {
        flush("|");
      }
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail !== "") segments.push({ text: tail, separator, unterminated: quote !== null });
  return segments;
}

/**
 * Splits a shell line into segments on `&&`, `||`, `;`, newlines and
 * a single `|`. Quotes (single and double) protect their content, so
 * `echo 'a && b'` stays one segment. Nothing is executed.
 */
export function splitSegments(command: string): string[] {
  return splitRaw(command).map((segment) => segment.text);
}

/** Strips prefixes like `sudo` and `FOO=bar`. */
function headWord(segment: string): string {
  let rest = segment.trim();
  for (;;) {
    const match = PREFIX.exec(rest);
    if (match === null) break;
    rest = rest.slice(match[0].length);
  }
  const word = /^\S+/.exec(rest);
  return word === null ? "" : word[0];
}

/** Command name without path and without quotes, in lowercase. */
function commandName(word: string): string {
  const cleaned = word.replace(/^["']/, "").replace(/["']$/, "");
  const parts = cleaned.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Looks in a pipeline for a downloader that ends up in a shell, such as
 * `curl … | sh`. The segments are already split, so this looks at the
 * separators between consecutive segments.
 */
function findPipeToShell(segments: readonly RawSegment[]): { reason: string; matched: string } | null {
  let downloadInPipe = false;
  let previous = "";

  for (const segment of segments) {
    if (segment.separator !== "|") downloadInPipe = false;
    const name = commandName(headWord(segment.text));

    if (segment.separator === "|" && downloadInPipe && SHELLS.has(name)) {
      const chain = `${previous} | ${segment.text}`;
      return {
        reason: `segment "${chain}" pipes a download into ${name}`,
        matched: chain,
      };
    }
    if (DOWNLOADERS.has(name)) downloadInPipe = true;

    if (segment.separator === "|" && previous !== "") {
      previous = `${previous} | ${segment.text}`;
    } else {
      previous = segment.text;
    }
  }
  return null;
}

/** Judges a single segment with the first rule that matches. */
function classifySegment(segment: RawSegment, rules: readonly ShellRule[]): ShellDecision {
  const text = segment.text;

  if (segment.unterminated) {
    return {
      verdict: "ask",
      reason: `segment "${text}" has an unterminated quote, so it cannot be read safely`,
      matched: text,
    };
  }

  // A segment with a redirect or substitution can write something, also
  // when it starts with an innocent command: `allow` then no longer applies.
  const canWrite = /[<>`]|\$\(/.test(text);

  for (const rule of rules) {
    if (canWrite && rule.verdict === "allow") continue;
    if (!rule.pattern.test(text)) continue;
    return { verdict: rule.verdict, reason: rule.reason, matched: text };
  }

  return {
    verdict: "ask",
    reason: `segment "${text}" matches no rule, so it needs confirmation`,
    matched: text,
  };
}

/**
 * Determines what happens with a complete shell line. Each segment is
 * judged separately and the strictest verdict wins. Only throws on an empty
 * or whitespace-only line; odd quotes result in `ask`.
 */
export function classifyCommand(
  command: string,
  rules: readonly ShellRule[] = defaultRules,
): ShellDecision {
  if (command.trim() === "") {
    throw new Error(`cannot classify an empty command: ${JSON.stringify(command)}`);
  }

  for (const rule of WHOLE_LINE_RULES) {
    if (rule.pattern.test(command)) {
      return { verdict: rule.verdict, reason: rule.reason, matched: command.trim() };
    }
  }

  const segments = splitRaw(command);
  const first = segments[0];
  if (first === undefined) {
    return {
      verdict: "ask",
      reason: `command "${command.trim()}" has no runnable segment`,
      matched: command.trim(),
    };
  }

  let worst = classifySegment(first, rules);

  const pipe = findPipeToShell(segments);
  if (pipe !== null && SEVERITY.deny > SEVERITY[worst.verdict]) {
    worst = { verdict: "deny", reason: pipe.reason, matched: pipe.matched };
  }

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const decision = classifySegment(segment, rules);
    if (SEVERITY[decision.verdict] > SEVERITY[worst.verdict]) worst = decision;
  }

  return worst;
}
