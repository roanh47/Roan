import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Decision the policy attaches to a tool call.
 * - `allow`: the call may proceed without intervention
 * - `ask`: the user must confirm first
 * - `deny`: the call is rejected
 */
export type Decision = "allow" | "ask" | "deny";

export interface Policy {
  /** Decision per tool name. A missing tool falls back to the default rules. */
  tools: Record<string, Decision>;
  /** The working directory that paths are checked against. */
  workspace: string;
  /** Extra directories (name or path) that may never be written or read. */
  extraDenyDirs?: string[];
}

export interface PolicyVerdict {
  decision: Decision;
  reason: string;
}

/** Tools that can write, delete or execute something: never allowed silently. */
const WRITE_TOOLS: readonly string[] = ["write_file", "apply_patch", "run_shell", "delete_file"];

/** Directory names that are always denied, wherever they sit in the working directory. */
const PROTECTED_DIRS: readonly string[] = ["secrets", ".ssh", ".gnupg"];

/** Keys in the tool arguments that contain a path. */
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
 * Resolves a path to an absolute path and follows symbolic links for the part
 * that already exists. If the path does not exist (yet), the missing
 * segments stay as they are: so lexically resolved.
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
 * Determines whether `target` falls within the working directory. Relative paths
 * are checked against the working directory; paths that escape via `..` fall
 * outside it by definition.
 */
export function isInsideWorkspace(workspace: string, target: string): boolean {
  if (!isNonEmptyString(target)) return false;
  if (!isNonEmptyString(workspace)) return false;
  const root = resolvePath(workspace);
  const resolved = resolvePath(path.resolve(root, target));
  return isWithin(root, resolved);
}

/** Collects all path-like arguments, also in nested objects. */
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

/** Returns the denial reason for a path, or `null` if the path is allowed. */
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
 * Determines what happens with a tool call. Paths in the arguments always win:
 * a path outside the working directory or in a protected directory yields `deny`,
 * even if the policy explicitly allows the tool.
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

/** Default policy: reading and searching is allowed, writing and executing needs confirmation. */
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
