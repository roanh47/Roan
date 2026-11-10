/**
 * Classificatie van een shell-regel vóór uitvoering.
 *
 * De regel wordt lexicaal in segmenten geknipt (op `&&`, `||`, `;`, nieuwe
 * regels en enkele `|`), elk segment wordt langs de regels gelegd en het
 * slechtste oordeel wint: `deny` > `ask` > `allow`. Er wordt niets uitgevoerd
 * en niets geëxpandeerd; dit is puur tekst.
 */

export type ShellVerdict = "allow" | "ask" | "deny";

export interface ShellDecision {
  verdict: ShellVerdict;
  /** Waarom dit oordeel gegeven is. */
  reason: string;
  /** Het stuk tekst waarop het oordeel sloeg. */
  matched?: string;
}

export interface ShellRule {
  pattern: RegExp;
  verdict: ShellVerdict;
  reason: string;
}

/** Hoger is strenger; bij een keten wint het hoogste cijfer. */
const SEVERITY: Record<ShellVerdict, number> = { allow: 0, ask: 1, deny: 2 };

/** Opdrachten die het echte commando pas na zichzelf starten. */
const DOWNLOADERS: ReadonlySet<string> = new Set(["curl", "wget", "fetch", "aria2c", "http", "https"]);

/** Shells waarin een download uitgevoerd kan worden. */
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Paden waarbuiten niets geschreven mag worden. */
const SYSTEM_ROOTS = "(?:etc|usr|boot|dev)";

/** Voorvoegsels die het eigenlijke commando voorafgaan. */
const PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+|(?:sudo|doas|env|nohup|time|command|exec)\s+)/;

/**
 * Regels die pas op de hele regel kloppen, omdat hun gevaar in de combinatie
 * van segmenten zit (een fork bomb splitst zichzelf op `;` en `|`).
 */
const WHOLE_LINE_RULES: readonly ShellRule[] = [
  {
    pattern: /:\s*\(\s*\)\s*\{[^}]*\}\s*;?\s*:/,
    verdict: "deny",
    reason: "fork bomb",
  },
];

/**
 * Standaardregels, in volgorde: weigeren eerst, dan toestaan, dan navragen.
 * De eerste regel die past bepaalt het oordeel van dat segment.
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
  /** Scheidingsteken vóór dit segment; leeg voor het eerste segment. */
  separator: string;
  /** Waar als de quote in dit segment niet gesloten werd. */
  unterminated?: boolean;
}

/**
 * Lexicale splitsing die enkele en dubbele quotes respecteert. Geeft de
 * segmenten mét het scheidingsteken dat eraan voorafging, zodat een pijplijn
 * later herkend kan worden. Lege segmenten verdwijnen.
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
 * Splits een shell-regel in segmenten op `&&`, `||`, `;`, nieuwe regels en
 * enkele `|`. Quotes (enkel en dubbel) beschermen hun inhoud, dus
 * `echo 'a && b'` blijft één segment. Er wordt niets uitgevoerd.
 */
export function splitSegments(command: string): string[] {
  return splitRaw(command).map((segment) => segment.text);
}

/** Laat voorvoegsels als `sudo` en `FOO=bar` weg. */
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

/** Commando-naam zonder pad en zonder quotes, in kleine letters. */
function commandName(word: string): string {
  const cleaned = word.replace(/^["']/, "").replace(/["']$/, "");
  const parts = cleaned.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Zoekt in een pijplijn naar een downloader die in een shell uitkomt, zoals
 * `curl … | sh`. De segmenten zijn al gesplitst, dus dit kijkt naar de
 * scheidingstekens tussen opeenvolgende segmenten.
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

/** Beoordeelt één segment met de eerste regel die past. */
function classifySegment(segment: RawSegment, rules: readonly ShellRule[]): ShellDecision {
  const text = segment.text;

  if (segment.unterminated) {
    return {
      verdict: "ask",
      reason: `segment "${text}" has an unterminated quote, so it cannot be read safely`,
      matched: text,
    };
  }

  // Een segment met een omleiding of substitutie kan iets wegschrijven, ook
  // als het met een onschuldig commando begint: `allow` vervalt dan.
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
 * Bepaalt wat er met een volledige shell-regel gebeurt. Elk segment wordt
 * apart beoordeeld en het strengste oordeel wint. Gooit alleen bij een lege
 * of alleen-witruimte regel; vreemde quotes leveren `ask` op.
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
