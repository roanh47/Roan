import type { Tool } from "../types.js";
import { classifyCommand } from "./shell-allowlist.js";

/**
 * The one seam every tool call of a turn passes through.
 *
 * Three things happen here and nowhere else: a dangerous shell line always
 * asks the owner first, a tool the chain marked "ask" asks until an allow is
 * learned, and the `before_tool` / `after_tool` hooks fire around the call.
 * The tool itself stays unaware of all three.
 */

export type ApprovalAnswer = "allow" | "deny" | "timeout";

export interface GuardOptions {
  /** True when the chain says this tool asks and no allow was learned yet. */
  readonly ask: boolean;
  /**
   * Puts the question to the owner. A `reason` marks a one-off question about
   * this exact call: the answer must not be learned for the tool as a whole.
   */
  readonly askPermission: (
    tool: string,
    args: Record<string, unknown>,
    reason?: string,
  ) => Promise<ApprovalAnswer>;
  /** Fired right before the tool runs. A failure is the caller's to report. */
  readonly beforeTool?: (tool: string) => Promise<void>;
  /** Fired after the tool ran or threw. */
  readonly afterTool?: (tool: string, ok: boolean) => Promise<void>;
}

/**
 * Why this call is dangerous enough to ask about every time, or `null`.
 *
 * Only `run_shell` is judged, and only the classifier's `deny` verdict counts:
 * an unknown command is ordinary work, a recursive delete of the root is not.
 * The owner can still say yes — it is their machine — but never by default.
 */
export function dangerReason(tool: string, args: Record<string, unknown>): string | null {
  if (tool !== "run_shell") return null;
  const command = typeof args["command"] === "string" ? args["command"] : "";
  if (command.trim() === "") return null;
  const decision = classifyCommand(command);
  return decision.verdict === "deny" ? decision.reason : null;
}

/** A hook must never be able to take the turn down. */
async function quiet(work: Promise<void> | undefined): Promise<void> {
  if (work === undefined) return;
  try {
    await work;
  } catch {
    // reported by whoever supplied the hook
  }
}

export function guardTool(tool: Tool, options: GuardOptions): Tool {
  return {
    ...tool,
    async run(args, ctx) {
      const danger = dangerReason(tool.name, args);
      if (danger !== null || options.ask) {
        const answer = await options.askPermission(tool.name, args, danger ?? undefined);
        if (answer === "timeout") throw new Error("no approval arrived in time");
        if (answer === "deny") throw new Error("the user refused this tool call");
      }
      await quiet(options.beforeTool?.(tool.name));
      let output: string;
      try {
        output = await tool.run(args, ctx);
      } catch (error) {
        await quiet(options.afterTool?.(tool.name, false));
        throw error;
      }
      await quiet(options.afterTool?.(tool.name, true));
      return output;
    },
  };
}
