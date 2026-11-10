import { promises as fs } from "node:fs";
import path from "node:path";

/** Eén vermoedelijk geheim, met een geredigeerde preview in plaats van de waarde. */
export interface SecretFinding {
  /** Pad relatief ten opzichte van `root`, met forward slashes. */
  file: string;
  /** 1-based regelnummer. */
  line: number;
  /** 1-based kolom van het geheim binnen de regel. */
  column: number;
  /** Soort treffer, bijvoorbeeld `openai-key` of `assigned-credential`. */
  kind: string;
  /** Gematchte tekst met het midden weggelaten; nooit het volledige geheim. */
  preview: string;
}

export interface SecretsScanOptions {
  /** Maximum aantal daadwerkelijk gelezen bestanden (standaard 2000). */
  maxFiles?: number;
  /** Maximum aantal treffers (standaard 500). */
  maxFindings?: number;
  /** Stopt het scannen vroegtijdig; het resultaat is dan onvolledig. */
  signal?: AbortSignal;
}

export interface SecretsScanResult {
  findings: SecretFinding[];
  /** Aantal bestanden dat als tekst is gelezen. */
  scanned: number;
  /** Aantal bestanden dat is overgeslagen: binair, te groot of onleesbaar. */
  skipped: number;
  /** Waar als niet alles bekeken is: door een limiet of een abort. */
  truncated: boolean;
}

/** Mappen die we nooit inlopen: nooit van de gebruiker en te groot. */
const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build"]);

/** Hoeveel bytes we inlezen om te bepalen of een bestand binair is. */
const SNIFF_BYTES = 8192;

/** Bestanden boven deze maat slaan we over: te duur en zelden interessant. */
const MAX_FILE_BYTES = 1024 * 1024;

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FINDINGS = 500;

/** Bovengrens voor de preview; ruim boven wat `redact` ooit teruggeeft. */
const MAX_PREVIEW = 120;

interface Rule {
  kind: string;
  source: string;
  flags?: string;
  /** Capturegroep met de eigenlijke geheimtekst; 0 betekent de hele match. */
  secretGroup?: number;
  /** Extra filter: waarden die geen geheim zijn (plaatshouders) vallen af. */
  filter?: (value: string) => boolean;
}

interface CompiledRule {
  kind: string;
  re: RegExp;
  secretGroup: number;
  filter?: (value: string) => boolean;
}

/**
 * Waarden die op een plaatshouder lijken en dus geen geheim zijn.
 * Bewust smal: liever een treffer te veel dan een echt geheim missen.
 */
const PLACEHOLDER: RegExp =
  /^(?:\$\{|<|%\{|\{\{|change(?:me|_me)?|placeholder|example|your(?:[_-].*)?|todo|none|null|true|false|x{3,}|\*+)$/i;

function isPlaceholder(value: string): boolean {
  const text = value.trim();
  if (text.length < 4) return true;
  if (text.includes("{") && text.includes("}")) return true;
  return PLACEHOLDER.test(text);
}

/**
 * Detectieregels, in deze volgorde geëvalueerd. `sk-ant-` staat vóór `sk-`
 * zodat een Anthropic-sleutel niet als OpenAI-sleutel gerapporteerd wordt.
 */
const RULES: readonly Rule[] = [
  { kind: "anthropic-key", source: "\\bsk-ant-[A-Za-z0-9_-]{16,}" },
  { kind: "openai-key", source: "\\bsk-[A-Za-z0-9_-]{16,}" },
  { kind: "github-token", source: "\\bgh[pousr]_[A-Za-z0-9]{20,}" },
  { kind: "slack-token", source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}" },
  { kind: "google-api-key", source: "\\bAIza[0-9A-Za-z_-]{20,}" },
  { kind: "aws-access-key-id", source: "\\bAKIA[0-9A-Z]{16}\\b" },
  {
    kind: "bearer-token",
    source: "\\bauthorization\\s*[:=]\\s*[\"']?bearer\\s+([A-Za-z0-9._~+/=-]{10,})",
    flags: "i",
    secretGroup: 1,
  },
  {
    kind: "private-key",
    source: "-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----",
    flags: "i",
  },
  {
    // .env-regels, YAML en TOML: sleutelnaam met een geheim-achtig woord erin,
    // gevolgd door `=` of `:` en een waarde zonder witruimte of commentaar.
    kind: "assigned-credential",
    source:
      "^\\s*(?:export\\s+)?[\"']?[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)[A-Za-z0-9_.-]*[\"']?\\s*[:=]\\s*[\"']?([^\"'\\s#]{4,})",
    flags: "i",
    secretGroup: 1,
    filter: (value: string): boolean => !isPlaceholder(value),
  },
];

/**
 * Compileer de regels eenmalig per scan. Een kapot patroon is een programmeer-
 * fout en moet luidruchtig falen met de bron van het patroon erbij.
 */
function compileRules(): CompiledRule[] {
  return RULES.map((rule) => {
    try {
      const compiled: CompiledRule = {
        kind: rule.kind,
        re: new RegExp(rule.source, `g${rule.flags ?? ""}`),
        secretGroup: rule.secretGroup ?? 0,
      };
      if (rule.filter !== undefined) compiled.filter = rule.filter;
      return compiled;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`secrets-scan: ongeldig regex-patroon "${rule.source}": ${detail}`);
    }
  });
}

/**
 * Redigeer een gevonden waarde: eerste vier en laatste vier tekens blijven
 * staan, de rest wordt `…`. Korte waarden (<= 12 tekens) worden volledig
 * verborgen, want anders zou de preview het hele geheim alsnog bevatten.
 */
function redact(value: string): string {
  const text = value.trim();
  if (text.length <= 12) return "…";
  const preview = `${text.slice(0, 4)}…${text.slice(-4)}`;
  return preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored < 0 ? 0 : floored;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface Counters {
  skipped: number;
}

/**
 * Verzamel alle gewone bestanden onder `dir`, deterministisch gesorteerd.
 * Onleesbare mappen tellen als overgeslagen en leveren geen fout op.
 */
async function collectFiles(dir: string, signal: AbortSignal | undefined, counters: Counters): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    counters.skipped += 1;
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const found: string[] = [];
  for (const entry of entries) {
    if (signal?.aborted === true) break;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await collectFiles(path.join(dir, entry.name), signal, counters)));
      continue;
    }
    // Symbolische koppelingen vallen af: die kunnen lussen veroorzaken.
    if (entry.isFile()) found.push(path.join(dir, entry.name));
  }
  return found;
}

/**
 * Lees een bestand als tekst. Geeft `null` terug voor binaire bestanden,
 * bestanden boven de maatlimiet en alles wat niet leesbaar is.
 */
async function readTextFile(absPath: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    const info = await fs.stat(absPath);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;

    handle = await fs.open(absPath, "r");
    const sniffSize = Math.min(SNIFF_BYTES, info.size);
    const head = Buffer.alloc(sniffSize);
    const { bytesRead } = await handle.read(head, 0, sniffSize, 0);
    if (head.subarray(0, bytesRead).includes(0)) return null;

    const buf = await handle.readFile();
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}

/** Positie van de geheimtekst binnen de hele match, voor de kolom. */
function groupOffset(match: RegExpExecArray, value: string): number {
  if (value === match[0]) return 0;
  const at = match[0].indexOf(value);
  return at < 0 ? 0 : at;
}

function toRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

/**
 * Scan een map op vermoedelijke geheimen. Onleesbare, binaire en te grote
 * bestanden worden geteld als `skipped` en laten de scan nooit klappen.
 * Alleen een onbruikbare `root` of een kapot regex-patroon gooit een `Error`.
 */
export async function scanForSecrets(
  root: string,
  options: SecretsScanOptions = {},
): Promise<SecretsScanResult> {
  const rules = compileRules();
  const maxFiles = normalizeLimit(options.maxFiles, DEFAULT_MAX_FILES);
  const maxFindings = normalizeLimit(options.maxFindings, DEFAULT_MAX_FINDINGS);
  const signal = options.signal;
  const findings: SecretFinding[] = [];
  let scanned = 0;
  let truncated = false;

  const absoluteRoot = path.resolve(root);
  try {
    const info = await fs.stat(absoluteRoot);
    if (!info.isDirectory()) throw new Error("geen map");
  } catch (err) {
    throw new Error(`secrets-scan: kan map "${root}" niet scannen: ${toErrorMessage(err)}`);
  }

  const counters: Counters = { skipped: 0 };
  const files = await collectFiles(absoluteRoot, signal, counters);
  let stopped = false;

  for (const absPath of files) {
    if (signal?.aborted === true) {
      truncated = true;
      break;
    }
    if (scanned >= maxFiles) {
      truncated = true;
      break;
    }

    const content = await readTextFile(absPath);
    if (content === null) {
      counters.skipped += 1;
      continue;
    }
    scanned += 1;

    const file = toRelative(absoluteRoot, absPath);
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line === "") continue;
      for (const rule of rules) {
        for (const match of line.matchAll(rule.re)) {
          const value = rule.secretGroup === 0 ? match[0] : match[1] ?? "";
          if (value === "") continue;
          if (rule.filter !== undefined && !rule.filter(value)) continue;
          if (findings.length >= maxFindings) {
            truncated = true;
            stopped = true;
            break;
          }
          const start = (match.index ?? 0) + groupOffset(match, value);
          findings.push({
            file,
            line: index + 1,
            column: start + 1,
            kind: rule.kind,
            preview: redact(value),
          });
        }
        if (stopped) break;
      }
      if (stopped) break;
    }
    if (stopped) break;
  }

  return {
    findings,
    scanned,
    skipped: counters.skipped,
    truncated,
  };
}
