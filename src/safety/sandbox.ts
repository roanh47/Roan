/**
 * Detection and argv construction for OS-level command sandboxes.
 *
 * The module never executes anything and never guesses: it looks for a
 * wrapper that actually exists on the host and either returns the argv that
 * runs the command inside it, or says plainly that no sandbox is available.
 * A caller that cannot distinguish those two cases would end up claiming
 * protection it does not have, so the unsupported answer is a first-class
 * result rather than an empty wrap.
 *
 * Supported wrappers:
 * - Linux: `bwrap` (bubblewrap) — read-only root, writable workspace, private
 *   `/tmp`, no network; or `landlock-sandbox`, a helper that applies a
 *   Landlock ruleset plus a seccomp filter and then execs the command. Its
 *   contract is `landlock-sandbox [--rw <dir>]... -- <argv...>`.
 * - macOS: `sandbox-exec` with a deny-by-default profile: reads allowed,
 *   writes only under the workspace and the temp directories, no network.
 *
 * Everything is passed as an argv array, so the command is never re-quoted
 * into a shell string. Detection is presence, not a self-test: a wrapper that
 * is installed but cannot run makes the command fail loudly. It never falls
 * back to running unsandboxed.
 */

import { accessSync, constants } from "node:fs";
import path from "node:path";

/** The wrappers this module knows how to drive. */
export type SandboxKind = "bwrap" | "landlock-seccomp" | "sandbox-exec";

/** What the detection needs from the machine; injectable so tests stay offline. */
export interface SandboxProbe {
  /** Platform to detect for. Defaults to `process.platform`. */
  platform: NodeJS.Platform;
  /** True when `command` can be executed (absolute path or a name on PATH). */
  hasCommand(command: string): boolean;
}

/** A sandbox that will really be used. */
export interface SandboxSupported {
  readonly supported: true;
  readonly kind: SandboxKind;
  /** The wrapper executable that was found. */
  readonly command: string;
  /** One sentence saying what the wrapper confines. */
  readonly reason: string;
}

/** No usable sandbox; the caller must say so instead of implying safety. */
export interface SandboxUnsupported {
  readonly supported: false;
  readonly kind: null;
  readonly command: null;
  readonly reason: string;
}

export type SandboxDetection = SandboxSupported | SandboxUnsupported;

/** Options for `wrapShellCommand`. */
export interface WrapShellCommandOptions {
  /** Shell used to run the command inside the sandbox. Default `/bin/sh`. */
  shell?: string;
  /** Directory the command may write to; also the working directory. */
  workspace?: string;
}

/** A ready-to-spawn command line, plus whether it is actually confined. */
export interface WrappedCommand {
  /** argv for `child_process.spawn`; no shell interpolation involved. */
  readonly argv: string[];
  /** True only when `argv` really runs inside a detected sandbox. */
  readonly sandboxed: boolean;
  readonly kind: SandboxKind | null;
  /** Why it is or is not sandboxed, in one sentence. */
  readonly reason: string;
}

/** Linux wrappers, strongest first. */
const LINUX_CANDIDATES: readonly { kind: SandboxKind; command: string }[] = [
  { kind: "bwrap", command: "bwrap" },
  { kind: "landlock-seccomp", command: "landlock-sandbox" },
];

/** macOS wrapper. */
const DARWIN_COMMAND = "sandbox-exec";

/** Default shell inside the wrapper; every POSIX host has it. */
const DEFAULT_SHELL = "/bin/sh";

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH lookup that also accepts an absolute or relative path. */
function defaultHasCommand(command: string): boolean {
  if (command.includes("/")) {
    return isExecutable(command);
  }
  const rawPath = process.env["PATH"] ?? "";
  for (const dir of rawPath.split(path.delimiter)) {
    if (dir === "") continue;
    if (isExecutable(path.join(dir, command))) return true;
  }
  return false;
}

/** The probe used when none is injected: the real platform and the real PATH. */
export function defaultSandboxProbe(): SandboxProbe {
  return { platform: process.platform, hasCommand: defaultHasCommand };
}

/**
 * One honest sentence about a detection result. Never says "sandboxed" for an
 * unsupported result; it says there is no sandbox and what that means.
 */
export function describeSandbox(detection: SandboxDetection): string {
  if (!detection.supported) {
    return `No sandbox available: ${detection.reason}. Commands run unsandboxed.`;
  }
  return `Sandbox: ${detection.kind} via ${detection.command} — ${detection.reason}`;
}

/**
 * Find a usable sandbox for `probe.platform`.
 *
 * The order is deliberate: bubblewrap is the strongest option, the Landlock
 * helper is the fallback on kernels without unprivileged user namespaces, and
 * macOS has exactly one wrapper.
 */
export function detectSandbox(probe: SandboxProbe = defaultSandboxProbe()): SandboxDetection {
  if (probe.platform === "linux") {
    for (const candidate of LINUX_CANDIDATES) {
      if (!probe.hasCommand(candidate.command)) continue;
      const reason =
        candidate.kind === "bwrap"
          ? "the command runs with a read-only root, a writable workspace, a private /tmp and no network"
          : "the command runs under a Landlock ruleset with a seccomp filter and no network";
      return {
        supported: true,
        kind: candidate.kind,
        command: candidate.command,
        reason,
      };
    }
    return {
      supported: false,
      kind: null,
      command: null,
      reason: "neither bwrap nor landlock-sandbox is installed or on PATH",
    };
  }

  if (probe.platform === "darwin") {
    if (probe.hasCommand(DARWIN_COMMAND)) {
      return {
        supported: true,
        kind: "sandbox-exec",
        command: DARWIN_COMMAND,
        reason: "the command runs under a deny-by-default profile with no network access",
      };
    }
    return {
      supported: false,
      kind: null,
      command: null,
      reason: "sandbox-exec is not available on this macOS host",
    };
  }

  return {
    supported: false,
    kind: null,
    command: null,
    reason: `no sandbox wrapper is wired up for platform "${probe.platform}"`,
  };
}

/** Reject a value that cannot appear in an argv array or a profile string. */
function checkText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`${field} must not contain a NUL byte`);
  }
  return value;
}

/** A path is embedded in the macOS profile only when it has no syntax of its own. */
function profilePath(dir: string): string {
  if (dir.includes('"') || dir.includes("\\") || dir.includes("\n") || dir.includes("\r")) {
    throw new Error(
      `workspace ${JSON.stringify(dir)} cannot be expressed in a sandbox-exec profile`,
    );
  }
  return dir;
}

/** Deny by default; only the workspace and the temp dirs are writable. */
function darwinProfile(workspace: string | undefined): string {
  const writable = ['"/tmp"', '"/private/tmp"', '"/private/var/folders"'];
  if (workspace !== undefined) {
    writable.push(`"${profilePath(workspace)}"`);
  }
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec*)",
    "(allow process-fork)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    `(allow file-write* (subpath ${writable.join(") (subpath ")}))`,
  ].join("\n");
}

function bwrapArgv(
  binary: string,
  shell: string,
  command: string,
  workspace: string | undefined,
): string[] {
  const argv = [binary, "--ro-bind", "/", "/", "--tmpfs", "/tmp"];
  if (workspace !== undefined) {
    const dir = path.resolve(workspace);
    argv.push("--bind", dir, dir);
  }
  argv.push(
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--unshare-net",
    "--unshare-pid",
    "--die-with-parent",
    "--new-session",
  );
  if (workspace !== undefined) {
    argv.push("--chdir", path.resolve(workspace));
  }
  argv.push("--", shell, "-c", command);
  return argv;
}

function landlockArgv(
  binary: string,
  shell: string,
  command: string,
  workspace: string | undefined,
): string[] {
  const argv = [binary, "--no-network"];
  if (workspace !== undefined) {
    argv.push("--rw", path.resolve(workspace));
  }
  argv.push("--", shell, "-c", command);
  return argv;
}

function sandboxExecArgv(
  binary: string,
  shell: string,
  command: string,
  workspace: string | undefined,
): string[] {
  return [binary, "-p", darwinProfile(workspace), shell, "-c", command];
}

/**
 * Build the argv for `command`, wrapped when a sandbox was detected.
 *
 * With an unsupported detection the result is the plain `shell -c command`
 * argv and `sandboxed: false`; `reason` is the detection's own reason, so a
 * caller can pass it on without embellishing.
 */
export function wrapShellCommand(
  command: string,
  detection: SandboxDetection,
  options: WrapShellCommandOptions = {},
): WrappedCommand {
  const checked = checkText(command, "command");
  const shell = options.shell ?? DEFAULT_SHELL;
  checkText(shell, "shell");

  if (!detection.supported) {
    return {
      argv: [shell, "-c", checked],
      sandboxed: false,
      kind: null,
      reason: detection.reason,
    };
  }

  const workspace = options.workspace === undefined ? undefined : path.resolve(options.workspace);
  let argv: string[];
  if (detection.kind === "bwrap") {
    argv = bwrapArgv(detection.command, shell, checked, workspace);
  } else if (detection.kind === "landlock-seccomp") {
    argv = landlockArgv(detection.command, shell, checked, workspace);
  } else {
    argv = sandboxExecArgv(detection.command, shell, checked, workspace);
  }

  return {
    argv,
    sandboxed: true,
    kind: detection.kind,
    reason: detection.reason,
  };
}
