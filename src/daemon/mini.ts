import { Agent } from "../agent.js";
import type { ProviderConfig } from "../providers/adapter.js";
import type { EffortLevel } from "../providers/effort.js";
import type { Tool } from "../types.js";

/**
 * A Mini Roan: the same agent, in a context of its own, for one bounded task.
 *
 * It is not a second agent. It gets the same system prompt — identity, rules,
 * memory, skills — and the same tools, minus the one that would let it start
 * another Mini Roan. What it reads and tries stays in its own context; only
 * its summary goes back to the conversation that asked. Nothing it does is
 * written to the chain as conversation, so the turn that delegated stays the
 * one writer.
 */

export const MINI_ROAN_BRIEF = [
  "# You are a Mini Roan",
  "",
  "You are Roan, working on one bounded task that the main conversation handed you.",
  "You have your own context: the main conversation sees nothing of your work except your last message.",
  "Do the task, then answer with a short summary of what you did and what you found.",
  "Do not repeat whole files or command output; name the paths and the facts that matter.",
  "If the task cannot be done, say what stopped you.",
].join("\n");

/** How many model requests a Mini Roan may spend before it has to answer. */
export const MINI_ROAN_STEPS = 16;

export interface MiniRoanOptions {
  readonly provider: ProviderConfig;
  /** The prompt the main agent runs with; the brief is added in front. */
  readonly systemPrompt: string;
  /** The tools of the turn that delegates. `delegate` itself is removed here. */
  readonly tools: readonly Tool[];
  readonly cwd: string;
  readonly effort?: EffortLevel;
  readonly signal?: AbortSignal;
  readonly maxSteps?: number;
  /** Told the name of every tool the Mini Roan uses, as it uses it. */
  readonly onActivity?: (line: string) => void;
}

/** The tools a Mini Roan gets: everything except starting another one. */
export function miniRoanTools(tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => tool.name !== "delegate");
}

export async function runMiniRoan(options: MiniRoanOptions, task: string): Promise<string> {
  const wanted = task.trim();
  if (wanted.length === 0) throw new Error("a Mini Roan needs a task");
  const agent = new Agent({
    provider: options.provider,
    tools: miniRoanTools(options.tools),
    systemPrompt: `${MINI_ROAN_BRIEF}\n\n${options.systemPrompt}`,
    cwd: options.cwd,
    maxSteps: options.maxSteps ?? MINI_ROAN_STEPS,
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.onActivity !== undefined
      ? {
          onEvent: (event) => {
            if (event.type === "tool_start") options.onActivity?.(event.name);
          },
        }
      : {}),
  });
  const summary = (await agent.send(wanted)).trim();
  if (summary.length === 0) throw new Error("the Mini Roan finished without a summary");
  return summary;
}
