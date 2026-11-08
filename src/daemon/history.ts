import type { ChatMessage } from "../types.js";
import type { Event } from "../protocol/types.js";

interface MessageData { text?: unknown }
interface ToolCallData { name?: unknown; args?: unknown }
interface ToolResultData { name?: unknown; ok?: unknown; output?: unknown }

function textOf(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const t = (data as MessageData).text;
  return typeof t === "string" ? t : "";
}

/**
 * Replays the chain into chat messages. Tool calls are not replayed: their
 * results are, as plain tool messages, which is enough for the model to see
 * what happened without inventing call ids that no longer exist.
 */
export function historyFromEvents(events: readonly Event[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of events) {
    if (e.type === "message") {
      const text = textOf(e.data);
      if (text) out.push({ role: "user", content: text });
    } else if (e.type === "assistant") {
      const text = textOf(e.data);
      if (text) out.push({ role: "assistant", content: text });
    } else if (e.type === "tool_result") {
      const d = (e.data ?? {}) as ToolResultData;
      const name = typeof d.name === "string" ? d.name : "tool";
      const output = typeof d.output === "string" ? d.output : "";
      out.push({ role: "tool", tool_call_id: `replay-${e.id}`, name, content: output });
    }
  }
  return out;
}
