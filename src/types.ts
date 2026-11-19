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

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_end"; name: string; ok: boolean; output: string }
  | { type: "error"; message: string }
  | { type: "turn_end"; steps: number };
