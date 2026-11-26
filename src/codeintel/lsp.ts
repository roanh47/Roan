/**
 * Language-server presence and the two questions a reader asks most: where does
 * this name come from, and who else uses it.
 *
 * Nothing here spawns anything. `probeLanguageServer` only reads the disk: which
 * project markers a root holds, and whether one of the known binaries is
 * executable somewhere on `PATH`. That makes "no server installed" a real answer
 * instead of an exception, and it keeps the probe cheap enough to run whenever a
 * panel opens.
 *
 * The queries run over an injected `LspClient`, so tests pin the 1-based to
 * 0-based conversion and the handling of a server's several result shapes
 * without a language server on the box. A real client (which owns the process)
 * lives elsewhere; this module only decides what to ask and how to read the
 * answer.
 */

import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The languages a project marker can point at. */
export type LanguageId = "typescript" | "python" | "go";

/** One server this module knows how to start, and what makes it relevant. */
export interface LanguageServerSpec {
  /** Stable name, also the report's identity. */
  readonly id: string;
  /** The binary looked for on `PATH`; nothing is run to find it. */
  readonly command: string;
  /** argv the server needs to speak LSP over stdio. */
  readonly args: readonly string[];
  readonly language: LanguageId;
  /** Files at the root that suggest this language. */
  readonly markers: readonly string[];
}

/**
 * The servers worth trying, in the order a mixed root should prefer them. The
 * markers are deliberately files that only a project of that language carries;
 * a stray `package.json` in a Python repo still resolves through the Python
 * marker ranking below.
 */
export const LANGUAGE_SERVERS: readonly LanguageServerSpec[] = [
  {
    id: "typescript-language-server",
    command: "typescript-language-server",
    args: ["--stdio"],
    language: "typescript",
    markers: ["tsconfig.json", "jsconfig.json", "package.json"],
  },
  {
    id: "pyright",
    command: "pyright",
    args: ["--langserver"],
    language: "python",
    markers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
  },
  {
    id: "gopls",
    command: "gopls",
    args: [],
    language: "go",
    markers: ["go.mod", "go.work"],
  },
];

/** True when `bin` is executable somewhere the process can see. */
export interface PresenceProbe {
  (command: string): boolean;
}

/**
 * A probe that only reads the filesystem.
 *
 * Presence means "a file with that name is executable in a `PATH` directory",
 * nothing more: no version check, no `--version`, no run. On Windows the
 * `PATHEXT` list supplies the suffixes, because there is no such thing as an
 * executable file without one.
 */
export function pathProbe(env: NodeJS.ProcessEnv = process.env): PresenceProbe {
  const dirs = (env["PATH"] ?? "").split(path.delimiter).filter((dir) => dir.length > 0);
  const suffixes =
    process.platform === "win32"
      ? (env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";").filter((ext) => ext.length > 0)
      : [""];

  return (command: string): boolean => {
    if (command.length === 0) return false;
    const direct = command.includes("/") || command.includes("\\");
    const names = direct ? [command] : dirs.flatMap((dir) => suffixes.map((ext) => path.join(dir, command + ext)));
    for (const name of names) {
      try {
        accessSync(name, constants.X_OK);
        return true;
      } catch {
        // Not here; the next directory (or suffix) may have it.
      }
    }
    return false;
  };
}

/** A server that can be started: its spec and why it was picked. */
export interface LanguageServerAvailable {
  readonly available: true;
  readonly server: LanguageServerSpec;
  /** One sentence for a panel header, e.g. "typescript-language-server found on PATH". */
  readonly reason: string;
}

/** No server for this root; `missing` is what to install, `reason` says why. */
export interface LanguageServerUnavailable {
  readonly available: false;
  readonly reason: string;
  /** Commands that were looked for and not found. */
  readonly missing: readonly string[];
}

export type LanguageServerProbe = LanguageServerAvailable | LanguageServerUnavailable;

export interface ProbeOptions {
  /** Presence of a binary. Default: scan `PATH` from `env`. */
  readonly probe?: PresenceProbe;
  /** Does this absolute path exist? Default: `fs.existsSync`. */
  readonly exists?: (absolutePath: string) => boolean;
  /** Environment for the default probe. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Pick a server for `root`, by project markers and `PATH` presence only.
 *
 * A root that holds markers narrows the field to servers for those languages;
 * an unrelated server would only produce "no definition found" for every
 * symbol, so a missing one is reported as unavailable with the command to
 * install. A root with no markers at all falls back to the first known server
 * on `PATH`.
 */
export function probeLanguageServer(root: string, options: ProbeOptions = {}): LanguageServerProbe {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new Error("root must be a non-empty path");
  }
  const exists = options.exists ?? existsSync;
  const probe = options.probe ?? pathProbe(options.env ?? process.env);

  if (!exists(root)) {
    return { available: false, reason: `no such directory: ${root}`, missing: [] };
  }

  const matched = LANGUAGE_SERVERS.filter((server) =>
    server.markers.some((marker) => exists(path.join(root, marker))),
  );
  const ordered = matched.length > 0 ? matched : LANGUAGE_SERVERS;

  const server = ordered.find((candidate) => probe(candidate.command));
  if (server !== undefined) {
    const marker = server.markers.find((candidate) => exists(path.join(root, candidate)));
    const reason =
      marker === undefined
        ? `${server.command} found on PATH`
        : `${server.command} found on PATH; this root has ${marker}`;
    return { available: true, server, reason };
  }

  const missing = ordered.map((candidate) => candidate.command);
  const reason =
    matched.length > 0
      ? `this root looks like ${matched.map((candidate) => candidate.language).join(" / ")} ` +
        `(${matched.flatMap((candidate) => candidate.markers).filter((marker) => exists(path.join(root, marker))).join(", ") || "project markers"}), ` +
        `but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on PATH`
      : `no language server on PATH (looked for ${missing.join(", ")})`;

  return { available: false, reason, missing };
}

/** A zero-based position, exactly as LSP counts. */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

/** A half-open range in one document. */
export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

/** One hit: a URI plus the range inside it. */
export interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
}

/**
 * The part of a language server this module uses.
 *
 * Methods return `unknown` on purpose: LSP allows `Location`, `Location[]` and
 * `LocationLink[]`, and servers in the wild return `null` for "nothing". The
 * normaliser below is the one place that shape difference is handled.
 */
export interface LspClient {
  definition(uri: string, position: LspPosition): Promise<unknown>;
  references(
    uri: string,
    position: LspPosition,
    options: { readonly includeDeclaration: boolean },
  ): Promise<unknown>;
}

export interface ReferencesOptions {
  /** Include the declaration itself. LSP's default is false; a reader wants true. */
  readonly includeDeclaration?: boolean;
}

function isPosition(value: unknown): value is LspPosition {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { line?: unknown; character?: unknown };
  return (
    typeof candidate.line === "number" &&
    Number.isSafeInteger(candidate.line) &&
    candidate.line >= 0 &&
    typeof candidate.character === "number" &&
    Number.isSafeInteger(candidate.character) &&
    candidate.character >= 0
  );
}

function readRange(value: unknown): LspRange | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as { start?: unknown; end?: unknown };
  if (!isPosition(candidate.start) || !isPosition(candidate.end)) return null;
  return { start: candidate.start, end: candidate.end };
}

/**
 * Turn whatever the server returned into a flat, de-duplicated hit list.
 *
 * Accepts a single `Location`, an array, `LocationLink`s (`targetUri` +
 * `targetSelectionRange`) and `null`. Anything else is skipped rather than
 * thrown on: a server that answers in an unexpected shape should leave the
 * panel empty, not break the turn.
 */
export function normalizeLocations(result: unknown): LspLocation[] {
  const out: LspLocation[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as {
      uri?: unknown;
      range?: unknown;
      targetUri?: unknown;
      targetSelectionRange?: unknown;
      targetRange?: unknown;
    };
    const uri =
      typeof record.uri === "string" ? record.uri : typeof record.targetUri === "string" ? record.targetUri : null;
    const range =
      readRange(record.range) ?? readRange(record.targetSelectionRange) ?? readRange(record.targetRange);
    if (uri === null || range === null) return;
    const key = `${uri}@${String(range.start.line)}:${String(range.start.character)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ uri, range });
  };

  visit(result);
  return out;
}

/** A file path (or a `file://` URI) as the URI an LSP client expects. */
export function toUri(file: string): string {
  if (typeof file !== "string" || file.trim().length === 0) {
    throw new Error("file must be a non-empty path");
  }
  return file.startsWith("file://") ? file : pathToFileURL(path.resolve(file)).href;
}

/** 1-based line and column (what a reader types) to LSP's 0-based position. */
function toPosition(line: number, col: number): LspPosition {
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new Error("line must be a 1-based integer");
  }
  if (!Number.isSafeInteger(col) || col < 1) {
    throw new Error("col must be a 1-based integer");
  }
  return { line: line - 1, character: col - 1 };
}

/** Where the symbol at `line:col` (1-based) is defined. */
export async function definitionAt(
  client: LspClient,
  file: string,
  line: number,
  col: number,
): Promise<LspLocation[]> {
  const uri = toUri(file);
  const position = toPosition(line, col);
  return normalizeLocations(await client.definition(uri, position));
}

/** Every use of the symbol at `line:col` (1-based), plus its declaration by default. */
export async function referencesAt(
  client: LspClient,
  file: string,
  line: number,
  col: number,
  options: ReferencesOptions = {},
): Promise<LspLocation[]> {
  const uri = toUri(file);
  const position = toPosition(line, col);
  return normalizeLocations(
    await client.references(uri, position, { includeDeclaration: options.includeDeclaration !== false }),
  );
}

/** The two queries, bound to one client. */
export interface CodeIntel {
  definitionAt(file: string, line: number, col: number): Promise<LspLocation[]>;
  referencesAt(file: string, line: number, col: number, options?: ReferencesOptions): Promise<LspLocation[]>;
}

/** Bind a client once; the returned functions keep the 1-based reader API. */
export function createCodeIntel(client: LspClient): CodeIntel {
  return {
    definitionAt: (file, line, col) => definitionAt(client, file, line, col),
    referencesAt: (file, line, col, options) => referencesAt(client, file, line, col, options),
  };
}
