import { spawn } from "node:child_process";

/**
 * Hooks: your command, at a moment the agent already reaches.
 *
 * Deliberately small — a shell command per lifecycle point, run with the event
 * name in the environment. A hook that fails is reported and never stops the
 * turn: automation should not be able to take the agent down.
 */
export type HookPoint = "turn_start" | "turn_end" | "before_tool" | "after_tool";

export interface HookConfig {
  readonly [point: string]: readonly string[] | undefined;
}

export interface HookResult {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export async function runHooks(
  config: HookConfig | null,
  point: HookPoint,
  context: { readonly cwd: string; readonly extra?: Record<string, string> },
  timeoutMs = 30_000,
): Promise<HookResult[]> {
  const commands = config?.[point];
  if (commands === undefined || commands.length === 0) return [];
  const results: HookResult[] = [];
  for (const command of commands) {
    results.push(await runOne(command, point, context, timeoutMs));
  }
  return results;
}

function runOne(
  command: string,
  point: HookPoint,
  context: { readonly cwd: string; readonly extra?: Record<string, string> },
  timeoutMs: number,
): Promise<HookResult> {
  return new Promise<HookResult>((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: context.cwd,
      env: { ...process.env, ROAN_HOOK: point, ...context.extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ command, exitCode: -1, output: "could not start" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command, exitCode: code ?? -1, output: output.slice(-2000) });
    });
  });
}
