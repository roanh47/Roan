/**
 * Shell execution with hard limits.
 *
 * `runShell` spawns one `/bin/sh -c <command>` (or `cmd.exe /c` on Windows) in
 * a working directory that must live inside the workspace. The child runs in its
 * own process group on POSIX, so a timeout or abort kills the whole tree and not
 * just the shell that happens to be the direct child.
 *
 * Three guarantees:
 * - a timeout always terminates the child (SIGKILL, with a short grace period
 *   in case a pipe stays open);
 * - an `AbortSignal` does the same, immediately;
 * - combined stdout/stderr is capped, and the promise still settles even when a
 *   consumer never reads the pipes.
 *
 * A non-zero exit is *not* an error here: it comes back in `exitCode` together
 * with the captured output. Throwing is reserved for bad input (empty command, a
 * `cwd` outside the workspace, a missing directory) and for a spawn failure.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { isInsideWorkspace } from "./policy.js";

export interface RunShellOptions {
  /** The command line, passed verbatim to the shell's `-c` argument. */
  command: string;
  /** The workspace root; `cwd` is resolved against it and may not escape it. */
  workspace: string;
  /** Working directory for the child, absolute or relative to `workspace`. */
  cwd?: string;
  /** Wall-clock limit in milliseconds. Default 60s, at most 10 minutes. */
  timeoutMs?: number;
  /** Cap on the combined stdout+stderr bytes kept in memory. Default 64 KiB. */
  maxBytes?: number;
  /** Aborting kills the child tree and resolves the promise. */
  signal?: AbortSignal;
}

export interface RunShellResult {
  command: string;
  /** Absolute working directory the child actually ran in. */
  cwd: string;
  /** Exit status, or `null` when the child was killed or never started. */
  exitCode: number | null;
  /** The signal that terminated the child, if any (including our own SIGKILL). */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr joined in arrival-independent order, capped. */
  output: string;
  /** True when output was dropped because of `maxBytes`. */
  truncated: boolean;
  /** True when the timeout fired and the child was killed. */
  timedOut: boolean;
  /** True when `signal` was aborted before the child exited. */
  aborted: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/** Default wall-clock limit for one command. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Nothing may run longer than this, whatever the caller asks for. */
const MAX_TIMEOUT_MS = 600_000;
/** Default cap on combined output; big enough for a test run, small enough to keep. */
const DEFAULT_MAX_BYTES = 64 * 1024;
/** A caller may raise the cap, but never past this. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** After SIGKILL, how long we wait for `close` before settling anyway. */
const KILL_GRACE_MS = 2_000;

const IS_WINDOWS = process.platform === "win32";

/** Prefer bash when the machine has it; `/bin/sh` is the portable fallback. */
function shellPath(): string {
  const override = process.env["ROAN_SHELL"];
  if (override !== undefined && override.trim() !== "") {
    return override.trim();
  }
  if (IS_WINDOWS) {
    return process.env["ComSpec"] ?? "cmd.exe";
  }
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

function shellArgs(command: string): string[] {
  return IS_WINDOWS ? ["/d", "/s", "/c", command] : ["-c", command];
}

function positiveInt(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

/**
 * Kill the child and everything it started. On POSIX the child is a process
 * group leader (see `detached` below), so a negative pid reaches the whole
 * group; on Windows `ChildProcess.kill` is the only portable tool.
 */
function killTree(child: { pid?: number | undefined; kill(signal?: NodeJS.Signals): boolean }): void {
  if (!IS_WINDOWS && typeof child.pid === "number" && child.pid > 0) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through: the group may already be gone, or the pid was never a
      // group leader. The direct kill below is still worth trying.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Nothing left to kill.
  }
}

/** The absolute cwd to run in, refusing anything outside `workspace`. */
function resolveCwd(workspace: string, cwd: string | undefined): string {
  if (typeof workspace !== "string" || workspace.trim() === "") {
    throw new Error("workspace must be a non-empty path");
  }
  const root = path.resolve(workspace);

  let requested = root;
  if (cwd !== undefined) {
    if (typeof cwd !== "string" || cwd.trim() === "") {
      throw new Error("cwd must be a non-empty path");
    }
    requested = path.resolve(root, cwd);
  }

  if (!isInsideWorkspace(root, requested)) {
    throw new Error(`cwd "${cwd ?? requested}" is outside the workspace ${root}`);
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(requested);
  } catch {
    throw new Error(`cwd does not exist: ${requested}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`cwd is not a directory: ${requested}`);
  }
  return requested;
}

/**
 * Run `command` in a shell and collect its output.
 *
 * @throws when the command is empty, `cwd` escapes the workspace, or the shell
 * cannot be spawned. A non-zero exit code is reported, not thrown.
 */
export function runShell(options: RunShellOptions): Promise<RunShellResult> {
  const command = typeof options.command === "string" ? options.command.trim() : "";
  if (command === "") {
    throw new Error("command must be a non-empty string");
  }

  const cwd = resolveCwd(options.workspace, options.cwd);
  const timeoutMs = Math.min(
    positiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
    MAX_TIMEOUT_MS,
  );
  const maxBytes = Math.min(
    positiveInt(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes"),
    MAX_OUTPUT_BYTES,
  );
  const signal = options.signal;
  const startedAt = Date.now();

  // An already-aborted signal never spawns anything.
  if (signal?.aborted === true) {
    return Promise.resolve({
      command,
      cwd,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      output: "",
      truncated: false,
      timedOut: false,
      aborted: true,
      durationMs: 0,
    });
  }

  return new Promise<RunShellResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let budget = maxBytes;
    let droppedBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const take = (chunk: Buffer, sink: Buffer[]): void => {
      if (chunk.length === 0) return;
      if (budget <= 0) {
        droppedBytes += chunk.length;
        return;
      }
      if (chunk.length <= budget) {
        budget -= chunk.length;
        sink.push(chunk);
        return;
      }
      sink.push(chunk.subarray(0, budget));
      droppedBytes += chunk.length - budget;
      budget = 0;
    };

    const child = spawn(shellPath(), shellArgs(command), {
      cwd,
      // stdin is closed so a command that reads from it fails fast instead of
      // waiting for input that will never come.
      stdio: ["ignore", "pipe", "pipe"],
      // A dedicated process group lets a timeout kill grandchildren too.
      detached: !IS_WINDOWS,
      windowsHide: true,
    });

    const cleanup = (): void => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    };

    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      cleanup();

      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const truncated = droppedBytes > 0;
      let output = stdoutText;
      if (stderrText !== "") {
        output =
          output === ""
            ? stderrText
            : `${output}${output.endsWith("\n") ? "" : "\n"}${stderrText}`;
      }
      if (truncated) {
        output += `${output === "" ? "" : "\n"}…(output capped at ${maxBytes} bytes; ${droppedBytes} bytes dropped)`;
      }

      resolve({
        command,
        cwd,
        exitCode,
        signal: exitSignal,
        stdout: stdoutText,
        stderr: stderrText,
        output,
        truncated,
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
      });
    };

    /** Give the child a moment to die after SIGKILL, then settle regardless. */
    const armGrace = (): void => {
      if (graceTimer !== undefined) return;
      graceTimer = setTimeout(() => finish(null, "SIGKILL"), KILL_GRACE_MS);
      graceTimer.unref();
    };

    const onAbort = (): void => {
      if (settled) return;
      aborted = true;
      killTree(child);
      armGrace();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      take(chunk, stdout);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      take(chunk, stderr);
    });

    child.once("error", (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`could not start ${shellPath()}: ${err.message}`));
    });

    child.once("close", (code, exitSignal) => {
      finish(code, exitSignal ?? null);
    });

    // A child that dies while we are still attaching listeners is covered by
    // `close`; a child that never starts fires `error` instead.
    killTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killTree(child);
      armGrace();
    }, timeoutMs);
    killTimer.unref();

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
