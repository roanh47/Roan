import os from "node:os";
import path from "node:path";

/**
 * A redacted snapshot for the "about" pane and bug reports.
 *
 * There is no field for a key or token, and there must never be one. Every
 * free-text note goes through `scrubNote` before it lands here.
 */
export interface Diagnostics {
  generatedAt: string;
  node: string;
  platform: string;
  arch: string;
  appVersion: string;
  chainId?: string;
  headSeq?: number;
  providerId?: string;
  model?: string;
  workspace: string;
  homeCollapsed: boolean;
  peers: number;
  notes: string[];
}

export interface DiagnosticsInput {
  appVersion: string;
  chainId?: string;
  headSeq?: number;
  providerId?: string;
  model?: string;
  workspace: string;
  peers?: number;
  notes?: readonly string[];
}

const MAX_NOTE_LENGTH = 300;
const ELLIPSIS = "\u2026";
const REDACTED = "[redacted]";

// Local scrub: `src/protocol/redact.ts` does not exist yet. Delegate to it once it lands.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{4,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{4,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{4,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g,
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi,
];

function scrubNote(note: string): string {
  let text = note.trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTED);
  return text.length > MAX_NOTE_LENGTH
    ? `${text.slice(0, MAX_NOTE_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
    : text;
}

/** Rewrites a path under the home directory to `~/...`; reports whether it did. */
function collapseHome(workspace: string): { workspace: string; homeCollapsed: boolean } {
  const sep = path.sep;
  let home = os.homedir();
  if (home.endsWith(sep)) home = home.slice(0, -sep.length);
  if (home.length === 0) return { workspace, homeCollapsed: false };
  if (workspace === home) return { workspace: "~", homeCollapsed: true };
  for (const prefix of [`${home}${sep}`, `${home}/`]) {
    if (workspace.startsWith(prefix)) {
      return { workspace: `~${workspace.slice(home.length)}`, homeCollapsed: true };
    }
  }
  return { workspace, homeCollapsed: false };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

export function collectDiagnostics(input: DiagnosticsInput): Diagnostics {
  if (typeof input !== "object" || input === null) {
    throw new Error("diagnostics input must be an object");
  }
  const appVersion = requireText(input.appVersion, "appVersion");
  const collapsed = collapseHome(typeof input.workspace === "string" ? input.workspace : "");
  const diagnostics: Diagnostics = {
    generatedAt: new Date().toISOString(),
    node: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    appVersion,
    workspace: collapsed.workspace,
    homeCollapsed: collapsed.homeCollapsed,
    peers: input.peers === undefined ? 0 : requireCount(input.peers, "peers"),
    notes: (input.notes ?? []).map((note) => scrubNote(String(note))),
  };
  if (input.chainId !== undefined) diagnostics.chainId = requireText(input.chainId, "chainId");
  if (input.headSeq !== undefined) diagnostics.headSeq = requireCount(input.headSeq, "headSeq");
  if (input.providerId !== undefined) diagnostics.providerId = requireText(input.providerId, "providerId");
  if (input.model !== undefined) diagnostics.model = requireText(input.model, "model");
  return diagnostics;
}

/** Stable `key: value` lines in declaration order; absent optionals are omitted. */
export function formatDiagnostics(diagnostics: Diagnostics): string {
  const lines: string[] = [];
  const add = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) lines.push(`${key}: ${String(value)}`);
  };
  add("generatedAt", diagnostics.generatedAt);
  add("node", diagnostics.node);
  add("platform", diagnostics.platform);
  add("arch", diagnostics.arch);
  add("appVersion", diagnostics.appVersion);
  add("chainId", diagnostics.chainId);
  add("headSeq", diagnostics.headSeq);
  add("providerId", diagnostics.providerId);
  add("model", diagnostics.model);
  add("workspace", diagnostics.workspace);
  add("homeCollapsed", diagnostics.homeCollapsed);
  add("peers", diagnostics.peers);
  if (diagnostics.notes.length === 0) add("notes", "(none)");
  else for (const note of diagnostics.notes) lines.push(`note: ${note}`);
  return lines.join("\n");
}
