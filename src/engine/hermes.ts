import { spawn } from "node:child_process";

/**
 * The engine: Hermes, running on this machine.
 *
 * Roan is the chain and the app. It does not need its own tool loop to be real,
 * and pretending otherwise produced a bare assistant with four tools. Hermes is
 * MIT licensed, already on the machine, and brings the tool set, skills, memory
 * and MCP that would otherwise have to be rewritten line by line.
 *
 * One turn is one `hermes -z` run: prompts in, final answer out, executed in the
 * workspace of *this* device. Nothing here talks to the network itself — Hermes
 * does whatever it does locally.
 */
export interface HermesTurnOptions {
  readonly prompt: string;
  readonly cwd: string;
  /** Earlier turns, oldest first; sent as context because each run starts clean. */
  readonly history?: readonly { role: "user" | "assistant"; text: string }[];
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface HermesTurnResult {
  readonly text: string;
  readonly exitCode: number;
  readonly stderr: string;
}

/** Prompt-safe rendering of the conversation so far. */
export function renderHistory(
  history: readonly { role: "user" | "assistant"; text: string }[],
): string {
  if (history.length === 0) return "";
  const lines = history.map((message) =>
    `${message.role === "user" ? "Gebruiker" : "Jij"}: ${message.text.trim()}`,
  );
  return [
    "Dit is het gesprek tot nu toe, uit de keten. Gebruik het als context;",
    "de laatste regel is het nieuwe bericht waar je op antwoordt.",
    "",
    ...lines,
    "",
    "---",
    "",
  ].join("\n");
}

export async function runHermesTurn(options: HermesTurnOptions): Promise<HermesTurnResult> {
  const bin = process.env["ROAN_ENGINE_BIN"] ?? "hermes";
  const args = ["-z", `${renderHistory(options.history ?? [])}${options.prompt}`, "--in", options.cwd];
  if (options.model !== undefined && options.model.length > 0) args.push("-m", options.model);

  return new Promise<HermesTurnResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, HERMES_HEADLESS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`the engine did not finish within ${String(options.timeoutMs ?? 900_000)} ms`));
    }, options.timeoutMs ?? 900_000);

    options.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`could not start "${bin}": ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (code !== 0 && text.length === 0) {
        reject(new Error(`the engine exited with ${String(code)}: ${stderr.trim().slice(-400)}`));
        return;
      }
      resolve({ text, exitCode: code ?? 0, stderr });
    });
  });
}

/** Whether the engine is actually installed on this machine. */
export async function engineAvailable(bin = process.env["ROAN_ENGINE_BIN"] ?? "hermes"): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
