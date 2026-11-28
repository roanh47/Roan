import type { Tool } from "../types.js";
import type { MemoryHit } from "../knowledge/search.js";
import { TodoStore } from "./todo.js";

/**
 * Two tools the agent uses on itself: looking up what was said or learned
 * before, and keeping a task list for the work in front of it.
 *
 * Both are thin: the search and the list live in their own modules, and the
 * caller hands in whatever reaches the chain. Neither writes outside memory.
 */

const DEFAULT_HITS = 8;
const MAX_HITS = 25;

/** Finds earlier messages and distilled facts across every conversation. */
export function createMemorySearchTool(search: (query: string, limit: number) => readonly MemoryHit[]): Tool {
  return {
    name: "memory_search",
    description:
      "Search everything said and learned before, across all conversations: the owner's earlier " +
      "messages and the facts kept as memory. Use it when the owner refers to something from the " +
      "past, or before asking them for something they may already have told you.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for" },
        limit: { type: "number", description: `How many results, default ${String(DEFAULT_HITS)}` },
      },
      required: ["query"],
    },
    async run(args): Promise<string> {
      const query = typeof args["query"] === "string" ? args["query"].trim() : "";
      if (query.length === 0) throw new Error("query is empty: say what to look for");
      const asked = Number(args["limit"]);
      const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_HITS) : DEFAULT_HITS;
      const hits = search(query, limit);
      if (hits.length === 0) return `nothing found for "${query}"`;
      return hits
        .map((hit) => {
          const where = hit.source.session !== undefined ? `, conversation ${hit.source.session.slice(0, 8)}` : "";
          return `- [${hit.kind}${where}] ${hit.text}`;
        })
        .join("\n");
    },
  };
}

/** The list as the model reads it back after every change. */
export function renderTodos(store: TodoStore): string {
  const items = store.list();
  if (items.length === 0) return "the task list is empty";
  return items.map((item) => `${String(item.id)}. [${item.done ? "x" : " "}] ${item.text}`).join("\n");
}

function todoId(value: unknown): number {
  const id = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(id) || id < 1) throw new Error("id must be the number of a task from the list");
  return id;
}

/**
 * A task list for the work in one conversation. `storeFor` picks the list, so
 * two conversations never share one; the list lives as long as the daemon.
 */
export function createTodoTool(storeFor: () => TodoStore): Tool {
  return {
    name: "todo",
    description:
      "Keep a task list while you work on something with several steps. Add the steps first, mark " +
      "each done as you finish it, and check the list before you say the work is complete. " +
      "Every call answers with the whole list.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "done", "remove", "list"] },
        text: { type: "string", description: "The task, for add" },
        id: { type: "number", description: "Which task, for done and remove" },
      },
      required: ["action"],
    },
    async run(args): Promise<string> {
      const store = storeFor();
      const action = String(args["action"] ?? "");
      if (action === "add") store.add(typeof args["text"] === "string" ? args["text"] : "");
      else if (action === "done") store.complete(todoId(args["id"]));
      else if (action === "remove") store.remove(todoId(args["id"]));
      else if (action !== "list") throw new Error("action must be add, done, remove or list");
      return renderTodos(store);
    },
  };
}
