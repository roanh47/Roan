export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** One piece of a multimodal message: text, or an image as a data url. */
export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/**
 * Why a turn's loop stopped. Every exit names one of these, so a `turn_end`
 * never has to be read as "it just ended":
 *  - `completed`   the model answered without asking for more tools;
 *  - `budget`      the step budget ran out (the last request was the grace call);
 *  - `interrupted` the owner aborted the turn;
 *  - `watchdog`    the provider went silent past the stall deadline;
 *  - `empty`       the model answered with nothing twice, even after being told;
 *  - `overflow`    the conversation did not fit the window and could not shrink;
 *  - `released`    a turn that never reached the loop (the engine path).
 */
export type TurnEndReason =
  | "completed"
  | "budget"
  | "interrupted"
  | "watchdog"
  | "empty"
  | "overflow"
  | "released";

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_end"; name: string; ok: boolean; output: string }
  | { type: "error"; message: string }
  | { type: "turn_end"; steps: number; reason: TurnEndReason };
