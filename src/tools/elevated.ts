/**
 * The agent-facing half of elevation: a tool that may run *only* a command
 * line that is in the installed allowlist, and only through `sudo -n`.
 *
 * The tool never prompts. `-n` makes sudo fail immediately when a password
 * would be needed, which is the correct outcome: the owner either ran the
 * install command once, or the call is refused and stays refused. The tool also
 * refuses when the platform has no mechanism or no rule is installed, and says
 * which one it is.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import type { Tool, ToolContext } from "../types.js";
import { elevationStatus, normalizeCommand, type ElevationStatus } from "../sudo/install.js";

export interface ElevatedRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ElevatedToolOptions {
  /** The same list that was installed. The source of truth at runtime. */
  readonly commands: readonly string[];
  /** Where the rule lives; injected so tests never touch /etc. */
  readonly status: () => ElevationStatus | Promise<ElevationStatus>;
  /** Test seam; default runs `sudo -n <argv>` without a shell. */
  readonly run?: (argv: readonly string[]) => Promise<ElevatedRunResult>;
  readonly timeoutMs?: number;
}

/** Characters the runtime refuses even though no shell is involved. */
const SHELL_METACHARACTERS = /[;&|`$<>\n]/;

/** Minimal POSIX-ish word splitting: single and double quotes group arguments. */
export function splitCommandLine(line: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      started = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (started) {
        argv.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (quote !== null) throw new Error("command has an unterminated quote");
  if (started) argv.push(current);
  return argv;
}

/** Exact match against the installed allowlist, after whitespace normalisation. */
export function isAllowedCommand(commands: readonly string[], requested: string): boolean {
  const wanted = normalizeCommand(requested);
  return commands.some((command) => normalizeCommand(command) === wanted);
}

function defaultRun(timeoutMs: number): (argv: readonly string[]) => Promise<ElevatedRunResult> {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        "sudo",
        ["-n", ...argv],
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          const code = (error as { code?: number | string } | null)?.code;
          resolve({
            code: typeof code === "number" ? code : error === null ? 0 : null,
            stdout,
            stderr,
          });
        },
      );
    });
}

/**
 * Build the `run_elevated` tool. `run` receives argv, never a shell string, so
 * there is no second place where quoting can be reinterpreted.
 */
export function createElevatedTool(options: ElevatedToolOptions): Tool {
  const timer = options.timeoutMs ?? 120_000;
  const run = options.run ?? defaultRun(timer);

  return {
    name: "run_elevated",
    description:
      "Run one of the owner-approved commands as root. Only the exact command lines in the " +
      "elevation allowlist are accepted; sudo never prompts for a password.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The full command line, exactly as approved.",
        },
      },
      required: ["command"],
    },
    async run(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
      const requested = typeof args["command"] === "string" ? args["command"] : "";
      if (requested.trim() === "") throw new Error("empty command");
      if (SHELL_METACHARACTERS.test(requested)) {
        throw new Error("elevated command may not contain shell metacharacters");
      }

      const argv = splitCommandLine(requested);
      if (argv.length === 0) throw new Error("empty command");

      const status = await options.status();
      if (!status.supported) {
        throw new Error(`elevation is not supported on this machine: ${status.reason ?? "unknown reason"}`);
      }
      if (!status.installed) {
        throw new Error(
          'elevation is not installed: the owner must run "node dist/sudo/cli.js install" once as root for this machine',
        );
      }
      if (!isAllowedCommand(options.commands, requested)) {
        throw new Error(
          `command is not in the elevation allowlist (${path.basename(argv[0] ?? "?")}); ` +
            "add it to the installed rule first",
        );
      }

      const result = await run(argv);
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (result.code !== 0) {
        // `sudo -n` says "a password is required" when the rule is gone or does
        // not match. Translate that into the fix, not into a prompt.
        if (/password is required/i.test(output)) {
          throw new Error(
            "sudo refused because a password would be required: the installed rule does not cover " +
              'this command or was removed. Run "node dist/sudo/cli.js install" once as root; Roan never prompts.',
          );
        }
        throw new Error(`exit ${result.code ?? "?"}\n${output || "(no output)"}`);
      }
      return output === "" ? "(no output, exit 0)" : output;
    },
  };
}

/** Convenience for callers that only want the status function for the tool. */
export function elevationStatusFor(
  input: Parameters<typeof elevationStatus>[0] = {},
): () => ElevationStatus {
  return () => elevationStatus(input);
}
