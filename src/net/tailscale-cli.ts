/**
 * The only place that touches the `tailscale` binary.
 *
 * Read-only by design: `status --json`, `ip -4`. Nothing here can change the
 * network. Callers get a classified result instead of a raw child-process error,
 * because "not installed", "daemon down" and "logged out" need different fixes.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import type { TailscaleStatus } from "./tailscale-status.js";

export interface Logger {
  debug(message: string): void;
  warn(message: string): void;
}

/** Silent by default: the core emits events, it does not print. */
export const silentLogger: Logger = {
  debug: () => {},
  warn: () => {},
};

export type CommandFailure = "not-found" | "timeout" | "exit" | "error";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  failure: CommandFailure | null;
  /** Human-readable reason, safe to put in an error message (never a secret). */
  message: string;
}

export type CommandRunner = (args: string[], timeoutMs: number) => Promise<CommandResult>;

export const DEFAULT_COMMAND_TIMEOUT_MS = 4000;

const TAILSCALE_BIN_CANDIDATES: Record<string, string[]> = {
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/snap/bin/tailscale"],
  darwin: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
};

/** Explicit override first, then PATH, then the per-platform install locations. */
export function binCandidates(explicit?: string): string[] {
  const platformPaths = TAILSCALE_BIN_CANDIDATES[os.platform()] ?? [];
  const all = [explicit, process.env["ROAN_TAILSCALE_BIN"], "tailscale", ...platformPaths];
  return [...new Set(all.filter((value): value is string => Boolean(value && value.trim())))];
}

function classifyExecError(error: NodeJS.ErrnoException, stderr: string): CommandResult {
  if (error.code === "ENOENT") {
    return { ok: false, stdout: "", stderr, code: null, failure: "not-found", message: "tailscale not found" };
  }
  if ((error as NodeJS.ErrnoException & { killed?: boolean }).killed === true || error.code === "ETIMEDOUT") {
    return {
      ok: false,
      stdout: "",
      stderr,
      code: null,
      failure: "timeout",
      message: "tailscale did not answer in time",
    };
  }
  return {
    ok: false,
    stdout: "",
    stderr,
    code: typeof error.code === "number" ? error.code : null,
    failure: "error",
    message: error.message,
  };
}

function execOnce(bin: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        const err = error as NodeJS.ErrnoException | null;
        const out = stdout ?? "";
        const errOut = stderr ?? "";
        if (!err) {
          resolve({ ok: true, stdout: out, stderr: errOut, code: 0, failure: null, message: "" });
          return;
        }
        resolve({ ...classifyExecError(err, errOut), stdout: out });
      },
    );
  });
}

/** Runs `tailscale` with the first binary that exists on this machine. */
export function makeRunner(explicitBin?: string): CommandRunner {
  const bins = binCandidates(explicitBin);
  return async (args, timeoutMs) => {
    let lastNotFound: CommandResult | null = null;
    for (const bin of bins) {
      const result = await execOnce(bin, args, timeoutMs);
      if (result.failure !== "not-found") return result;
      lastNotFound = result;
    }
    return (
      lastNotFound ?? {
        ok: false,
        stdout: "",
        stderr: "",
        code: null,
        failure: "not-found",
        message: "tailscale not found on PATH",
      }
    );
  };
}

/** Map a failed invocation onto an availability plus one actionable sentence. */
export function classifyFailure(result: CommandResult): {
  availability: TailscaleStatus["availability"];
  error: string;
} {
  if (result.failure === "not-found") {
    return { availability: "not-installed", error: "tailscale is not installed or not on PATH" };
  }
  if (result.failure === "timeout") {
    return { availability: "unknown", error: "tailscale status timed out; is tailscaled wedged?" };
  }

  const text = `${result.stderr} ${result.stdout}`.toLowerCase();
  if (/needslogin|logged out|log in at|not logged in|to authenticate/.test(text)) {
    return { availability: "needs-login", error: "tailscale is not logged in; run `tailscale up`" };
  }
  if (
    /failed to connect to local tailscale daemon|tailscaled.*not running|connection refused|tailscale is stopped/.test(
      text,
    )
  ) {
    return { availability: "not-running", error: "tailscale is installed but tailscaled is not running" };
  }

  const detail = result.stderr.trim() || result.message || `exit code ${result.code ?? "unknown"}`;
  return { availability: "unknown", error: `tailscale status failed: ${detail}` };
}
