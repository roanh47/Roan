import { promises as fs } from "node:fs";
import path from "node:path";

/** Een aanroep van een tool die de werkmap kan veranderen. */
export type MutatingCall =
  | { tool: "write_file"; path: string; content: string }
  | { tool: "apply_patch"; path: string; oldText: string; newText: string }
  | { tool: "run_shell"; command: string; cwd?: string };

/** Wat een bevestigingskaart nodig heeft: één samenvatting, details, en of er iets verloren kan gaan. */
export interface DryRunResult {
  summary: string;
  details: string[];
  destructive: boolean;
}

/** Commando's die onherstelbaar kunnen zijn; we matchen op hele woorden zodat "format" niet telt. */
const SHELL_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "rm", re: /\brm\b/ },
  { label: "mv", re: /\bmv\b/ },
  { label: "dd", re: /\bdd\b/ },
  { label: "mkfs", re: /\bmkfs\b/ },
  { label: "truncate", re: /\btruncate\b/ },
];

/** `>` of `>>` gevolgd door een absoluut pad; de lookbehind voorkomt dat `>>` dubbel telt. */
const ABSOLUTE_REDIRECT = /(?<!>)>>?\s*(\/[^\s;|&<>]*)/g;

const MAX_SUMMARY_COMMAND = 160;
const MAX_OCCURRENCE_LINES = 5;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Leest de foutcode (`ENOENT`, `EACCES`, …) zonder naar `any` te grijpen. */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Splits in regels; een afsluitende nieuwe regel telt niet als extra lege regel. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const body = text.replace(/\r\n/g, "\n");
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return trimmed === "" ? [] : trimmed.split("\n");
}

/** Tel exacte, niet-overlappende voorkomens van een stuk tekst. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Regelnummer (1-based) van een tekenpositie. */
function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Beginregels van de eerste `limit` voorkomens, voor de detailregels. */
function occurrenceLines(text: string, needle: string, limit: number): number[] {
  const lines: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1 && lines.length < limit) {
    lines.push(lineNumberAt(text, index));
    index = text.indexOf(needle, index + needle.length);
  }
  return lines;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/** "1 line" / "2 lines", zodat een kaart niet "1 lines" toont. */
function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** Relatief pad binnen de werkmap, anders het absolute pad. */
function displayPath(resolved: string): string {
  const relative = path.relative(process.cwd(), resolved);
  if (relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return resolved;
  return relative.split(path.sep).join("/");
}

/** Relatieve paden worden tegen process.cwd() afgezet; een leeg pad is een programmeerfout. */
function resolveTarget(tool: string, raw: string): string {
  if (raw.trim() === "") throw new Error(`${tool}: path is empty`);
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

function isOutsideCwd(resolved: string): boolean {
  const relative = path.relative(process.cwd(), resolved);
  if (relative === "") return false;
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/** Alles wat we lezen over het doelpad; nooit een schrijfactie. */
interface Inspection {
  resolved: string;
  shown: string;
  exists: boolean;
  isFile: boolean;
  size: number;
  lines: number;
  content: string | null;
  problem: string | null;
}

async function inspect(tool: string, rawPath: string): Promise<Inspection> {
  const resolved = resolveTarget(tool, rawPath);
  const base: Inspection = {
    resolved,
    shown: displayPath(resolved),
    exists: false,
    isFile: false,
    size: 0,
    lines: 0,
    content: null,
    problem: null,
  };

  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") return base;
    return { ...base, problem: `could not inspect the path: ${describeError(err)}` };
  }

  if (!stats.isFile()) return { ...base, exists: true, isFile: false };

  let content: string;
  try {
    content = await fs.readFile(resolved, "utf8");
  } catch (err) {
    return {
      ...base,
      exists: true,
      isFile: true,
      size: stats.size,
      problem: `could not read the file: ${describeError(err)}`,
    };
  }

  return {
    ...base,
    exists: true,
    isFile: true,
    size: stats.size,
    lines: toLines(content).length,
    content,
  };
}

async function describeWriteFile(call: {
  path: string;
  content: string;
}): Promise<DryRunResult> {
  const inspection = await inspect("write_file", call.path);
  const shown = inspection.shown;
  const nextBytes = Buffer.byteLength(call.content, "utf8");
  const nextLines = toLines(call.content).length;

  if (inspection.problem !== null) {
    return {
      summary: `Could not inspect ${shown}: ${inspection.problem}.`,
      details: [`path: ${shown}`],
      destructive: false,
    };
  }

  if (inspection.exists && !inspection.isFile) {
    return {
      summary: `Would fail: ${shown} exists but is not a regular file.`,
      details: [`path: ${shown}`, "write_file can only replace a regular file or create a new one."],
      destructive: false,
    };
  }

  const newContentLine = `new content: ${plural(nextBytes, "byte")}, ${plural(nextLines, "line")}`;

  if (!inspection.exists) {
    return {
      summary: `Create ${shown} with ${plural(nextBytes, "byte")} and ${plural(nextLines, "line")}.`,
      details: [`path: ${shown}`, "file does not exist yet, so nothing is overwritten", newContentLine],
      destructive: nextBytes === 0,
    };
  }

  const sizeDelta = nextBytes - inspection.size;
  const lineDelta = nextLines - inspection.lines;
  const details = [
    `path: ${shown}`,
    `current content: ${plural(inspection.size, "byte")}, ${plural(inspection.lines, "line")}`,
    newContentLine,
    `size change: ${signed(sizeDelta)} bytes`,
    `line change: ${inspection.lines} → ${nextLines} (${signed(lineDelta)})`,
  ];

  if (nextBytes === 0) {
    return {
      summary: `Empty ${shown}, discarding ${plural(inspection.size, "byte")} and ${plural(inspection.lines, "line")}.`,
      details,
      destructive: true,
    };
  }

  return {
    summary: `Overwrite ${shown}: ${plural(inspection.size, "byte")} / ${plural(inspection.lines, "line")} become ${plural(nextBytes, "byte")} / ${plural(nextLines, "line")}.`,
    details,
    destructive: inspection.size > 0,
  };
}

async function describeApplyPatch(call: {
  path: string;
  oldText: string;
  newText: string;
}): Promise<DryRunResult> {
  const inspection = await inspect("apply_patch", call.path);
  const shown = inspection.shown;
  const pathLine = `path: ${shown}`;

  if (inspection.problem !== null) {
    return {
      summary: `Could not read ${shown}: ${inspection.problem}.`,
      details: [pathLine],
      destructive: false,
    };
  }

  if (!inspection.exists) {
    return {
      summary: `Would be refused: file does not exist: ${shown}.`,
      details: [pathLine, "apply_patch never creates a file, so this call would fail."],
      destructive: false,
    };
  }

  if (!inspection.isFile) {
    return {
      summary: `Would be refused: ${shown} is not a regular file.`,
      details: [pathLine],
      destructive: false,
    };
  }

  if (call.oldText === "") {
    return {
      summary: `Would be refused: the search pattern for ${shown} is empty.`,
      details: [pathLine, "apply_patch needs the exact text that should be replaced."],
      destructive: false,
    };
  }

  const content = inspection.content ?? "";
  const count = countOccurrences(content, call.oldText);
  const patternLines = toLines(call.oldText).length;

  if (count === 0) {
    return {
      summary: `Would be refused: pattern not found in ${shown}.`,
      details: [pathLine, `searched for ${patternLines} line(s) of text`, "no occurrence found"],
      destructive: false,
    };
  }

  if (count > 1) {
    const lines = occurrenceLines(content, call.oldText, MAX_OCCURRENCE_LINES);
    const lineList = lines.join(", ");
    const more = count > lines.length ? ` (first ${lines.length} shown)` : "";
    return {
      summary: `Would be refused: pattern appears ${plural(count, "time")} in ${shown}.`,
      details: [pathLine, `occurrences start at lines: ${lineList}${more}`, "the pattern must be unique"],
      destructive: false,
    };
  }

  if (call.oldText === call.newText) {
    return {
      summary: `No change: the pattern and its replacement are identical in ${shown}.`,
      details: [pathLine],
      destructive: false,
    };
  }

  const at = content.indexOf(call.oldText);
  const startLine = lineNumberAt(content, at);
  const removed = toLines(call.oldText).length;
  const added = toLines(call.newText).length;
  const outside = isOutsideCwd(inspection.resolved);

  const details = [
    pathLine,
    `pattern found once, starting at line ${startLine}`,
    `lines removed: ${removed}`,
    `lines added: ${added}`,
    `line change: ${signed(added - removed)}`,
  ];
  if (outside) {
    details.push(`file is outside the working directory ${process.cwd()}`);
  }

  return {
    summary: `Replace ${plural(removed, "line")} with ${plural(added, "line")} in ${shown}, starting at line ${startLine}.`,
    details,
    destructive: outside,
  };
}

function describeRunShell(call: { command: string; cwd?: string }): DryRunResult {
  if (call.command.trim() === "") throw new Error("run_shell: command is empty");

  const requestedCwd = call.cwd ?? "";
  const cwd = requestedCwd.trim() === "" ? process.cwd() : path.resolve(process.cwd(), requestedCwd);
  const cwdShown = cwd;
  const shortCommand =
    call.command.length > MAX_SUMMARY_COMMAND
      ? `${call.command.slice(0, MAX_SUMMARY_COMMAND - 1)}…`
      : call.command;

  const details: string[] = [
    `command: ${call.command}`,
    call.cwd === undefined ? `cwd: ${cwdShown} (default working directory)` : `cwd: ${cwdShown}`,
  ];

  const matched: string[] = [];
  for (const pattern of SHELL_PATTERNS) {
    if (pattern.re.test(call.command)) matched.push(pattern.label);
  }

  const redirectTargets: string[] = [];
  for (const match of call.command.matchAll(ABSOLUTE_REDIRECT)) {
    const target = match[1];
    if (target !== undefined && target !== "" && !redirectTargets.includes(target)) {
      redirectTargets.push(target);
    }
  }

  for (const label of matched) {
    details.push(`contains risky command: ${label}`);
  }
  for (const target of redirectTargets) {
    details.push(`redirects output to absolute path: ${target}`);
  }
  if (matched.length === 0 && redirectTargets.length === 0) {
    details.push("no destructive pattern detected in the command text");
  }

  return {
    summary: `Run shell command in ${cwdShown}: ${shortCommand}`,
    details,
    destructive: matched.length > 0 || redirectTargets.length > 0,
  };
}

/**
 * Beschrijft wat een aanroep zou doen zonder iets uit te voeren: alleen stat en
 * readFile op het doelpad, nooit een schrijfactie, proces of verwijdering.
 */
export async function describeCall(call: MutatingCall): Promise<DryRunResult> {
  switch (call.tool) {
    case "write_file":
      return describeWriteFile(call);
    case "apply_patch":
      return describeApplyPatch(call);
    case "run_shell":
      return describeRunShell(call);
  }
}
