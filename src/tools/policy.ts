import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Beslissing die het beleid aan een tool-aanroep hangt.
 * - `allow`: de aanroep mag zonder tussenkomst door
 * - `ask`: de gebruiker moet eerst bevestigen
 * - `deny`: de aanroep wordt geweigerd
 */
export type Decision = "allow" | "ask" | "deny";

export interface Policy {
  /** Beslissing per toolnaam. Een ontbrekende tool valt terug op de standaardregels. */
  tools: Record<string, Decision>;
  /** De werkmap waar paden tegenaan worden afgezet. */
  workspace: string;
  /** Extra mappen (naam of pad) die nooit beschreven of gelezen mogen worden. */
  extraDenyDirs?: string[];
}

export interface PolicyVerdict {
  decision: Decision;
  reason: string;
}

/** Tools die iets kunnen schrijven, verwijderen of uitvoeren: nooit stilzwijgend toegestaan. */
const WRITE_TOOLS: readonly string[] = ["write_file", "apply_patch", "run_shell", "delete_file"];

/** Mapnamen die altijd geweigerd worden, waar ze ook in de werkmap staan. */
const PROTECTED_DIRS: readonly string[] = ["secrets", ".ssh", ".gnupg"];

/** Sleutels in de tool-argumenten die een pad bevatten. */
const PATH_KEYS: ReadonlySet<string> = new Set([
  "path",
  "paths",
  "file",
  "files",
  "filename",
  "filepath",
  "file_path",
  "target",
  "targets",
  "target_path",
  "source",
  "src",
  "dest",
  "destination",
  "dir",
  "directory",
  "cwd",
  "root",
]);

const MAX_ARG_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Lost een pad op tot een absoluut pad en volgt symbolische links voor het deel
 * dat al bestaat. Bestaat het pad (nog) niet, dan blijven de ontbrekende
 * segmenten staan zoals ze zijn: lexicaal opgelost dus.
 */
function resolvePath(input: string): string {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let candidate = absolute;
  for (;;) {
    try {
      const real = realpathSync(candidate);
      return missing.length === 0 ? real : path.join(real, ...missing.slice().reverse());
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolute;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isWithin(root: string, resolved: string): boolean {
  if (resolved === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(prefix);
}

/**
 * Bepaalt of `target` binnen de werkmap valt. Relatieve paden worden tegen de
 * werkmap afgezet; paden die via `..` ontsnappen vallen er per definitie buiten.
 */
export function isInsideWorkspace(workspace: string, target: string): boolean {
  if (!isNonEmptyString(target)) return false;
  if (!isNonEmptyString(workspace)) return false;
  const root = resolvePath(workspace);
  const resolved = resolvePath(path.resolve(root, target));
  return isWithin(root, resolved);
}

/** Verzamelt alle pad-achtige argumenten, ook in geneste objecten. */
function collectPaths(args: unknown, depth = 0): string[] {
  const found: string[] = [];
  if (depth > MAX_ARG_DEPTH || !isRecord(args)) return found;

  for (const [key, value] of Object.entries(args)) {
    if (PATH_KEYS.has(key.toLowerCase())) {
      if (isNonEmptyString(value)) {
        found.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isNonEmptyString(item)) {
            found.push(item);
          } else if (isRecord(item)) {
            found.push(...collectPaths(item, depth + 1));
          }
        }
      } else if (isRecord(value)) {
        found.push(...collectPaths(value, depth + 1));
      }
      continue;
    }
    if (isRecord(value)) {
      found.push(...collectPaths(value, depth + 1));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) found.push(...collectPaths(item, depth + 1));
      }
    }
  }
  return found;
}

/** Geeft de weigeringsreden voor een pad, of `null` als het pad mag. */
function pathViolation(policy: Policy, raw: string): string | null {
  const root = resolvePath(policy.workspace);
  const resolved = resolvePath(path.resolve(root, raw));

  if (!isWithin(root, resolved)) {
    return `path "${raw}" escapes the workspace ${root}`;
  }

  const relative = path.relative(root, resolved);
  const segments = relative.split(path.sep).filter((segment) => segment !== "");

  const deniedNames = new Set<string>(PROTECTED_DIRS);
  const deniedRoots: string[] = [];
  for (const entry of policy.extraDenyDirs ?? []) {
    if (!isNonEmptyString(entry)) continue;
    const cleaned = entry.trim().replace(/[\\/]+$/, "");
    if (cleaned === "") continue;
    if (cleaned.includes(path.sep) || cleaned.includes("/")) {
      deniedRoots.push(resolvePath(path.resolve(root, cleaned)));
    } else {
      deniedNames.add(cleaned.toLowerCase());
    }
  }

  for (const segment of segments) {
    const name = segment.toLowerCase();
    if (deniedNames.has(name)) {
      return `path "${raw}" is inside protected directory "${segment}"`;
    }
  }
  for (const deniedRoot of deniedRoots) {
    if (isWithin(deniedRoot, resolved)) {
      return `path "${raw}" is inside denied directory ${deniedRoot}`;
    }
  }
  if (resolved.toLowerCase().endsWith(".pem")) {
    return `path "${raw}" is a .pem file and is never accessible`;
  }
  return null;
}

function isDeclaredDecision(value: Decision | undefined): value is Decision {
  return value === "allow" || value === "ask" || value === "deny";
}

/**
 * Bepaalt wat er met een tool-aanroep gebeurt. Paden in de argumenten winnen
 * altijd: een pad buiten de werkmap of in een beschermde map geeft `deny`, ook
 * als het beleid de tool expliciet toestaat.
 */
export function decide(
  policy: Policy,
  toolName: string,
  toolArgs: Record<string, unknown> = {},
): PolicyVerdict {
  const declared: Decision | undefined = Object.prototype.hasOwnProperty.call(policy.tools, toolName)
    ? policy.tools[toolName]
    : undefined;
  const configured = isDeclaredDecision(declared) ? declared : undefined;
  const writeCapable = WRITE_TOOLS.includes(toolName);

  for (const raw of collectPaths(toolArgs)) {
    const violation = pathViolation(policy, raw);
    if (violation !== null) {
      return { decision: "deny", reason: `tool "${toolName}": ${violation}` };
    }
  }

  if (configured === undefined) {
    if (writeCapable) {
      return {
        decision: "ask",
        reason: `tool "${toolName}" can modify the workspace and is not explicitly allowed, so it needs confirmation`,
      };
    }
    return {
      decision: "deny",
      reason: `tool "${toolName}" is not listed in the policy, so it is denied by default`,
    };
  }

  switch (configured) {
    case "allow":
      return { decision: "allow", reason: `tool "${toolName}" is allowed by policy` };
    case "ask":
      return { decision: "ask", reason: `tool "${toolName}" requires confirmation by policy` };
    case "deny":
      return { decision: "deny", reason: `tool "${toolName}" is denied by policy` };
  }
}

/** Standaardbeleid: lezen en zoeken mag, schrijven en uitvoeren vraagt bevestiging. */
export function defaultPolicy(workspace: string): Policy {
  return {
    tools: {
      read_file: "allow",
      list_dir: "allow",
      search_files: "allow",
      web_search: "allow",
      web_fetch: "allow",
      write_file: "ask",
      apply_patch: "ask",
      run_shell: "ask",
      delete_file: "ask",
    },
    workspace: path.resolve(workspace),
    extraDenyDirs: [],
  };
}
