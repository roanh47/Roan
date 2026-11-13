import type { Tool, ToolContext } from "../types.js";
import type { MemoryStore, MemoryTarget } from "../context/memory.js";
import { BUDGET } from "../context/memory.js";
import type { SkillLibrary } from "../context/skills.js";

function target(value: unknown): MemoryTarget {
  if (value === "user" || value === "memory") return value;
  throw new Error('target must be "user" (who they are) or "memory" (what you learned)');
}

function index(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("index must be 1 or higher");
  return parsed;
}

/**
 * The memory tool. Reads back what changed every time, because the agent's next
 * decision depends on how full the file is, not on what it hoped it wrote.
 */
export function createMemoryTool(store: MemoryStore): Tool {
  return {
    name: "memory",
    description:
      "Keep facts across sessions: who the user is (target user) and what you learned " +
      "(target memory). Adding when full fails — remove or shorten first.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "replace", "remove", "list"] },
        target: { type: "string", enum: ["user", "memory"] },
        text: { type: "string", description: "The entry, as one self-contained fact" },
        index: { type: "number", description: "Which entry, 1-based, from list" },
      },
      required: ["action", "target"],
    },
    async run(args): Promise<string> {
      const which = target(args["target"]);
      const action = String(args["action"] ?? "");
      if (action === "add") {
        const used = await store.add(which, String(args["text"] ?? ""));
        return `stored in ${which} (${used}/${BUDGET[which]} characters)`;
      }
      if (action === "replace") {
        const used = await store.replace(which, index(args["index"]), String(args["text"] ?? ""));
        return `replaced entry ${args["index"]} in ${which} (${used}/${BUDGET[which]} characters)`;
      }
      if (action === "remove") {
        const used = await store.remove(which, index(args["index"]));
        return `removed entry ${args["index"]} from ${which} (${used}/${BUDGET[which]} characters)`;
      }
      if (action === "list") {
        const entries = await store.entries(which);
        const budget = await store.budget(which);
        const lines = entries.map((entry) => `${entry.index}. ${entry.text}`);
        return `${which}: ${budget.used}/${budget.limit} characters\n${lines.join("\n")}`;
      }
      throw new Error("action must be add, replace, remove or list");
    },
  };
}

/** Opens a skill's instructions, or one file that came with it. */
export function createSkillTools(library: SkillLibrary): readonly Tool[] {
  return [
    {
      name: "skill_view",
      description: "Read a skill's instructions. Call this before doing work the skill covers.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Skill name from the list" } },
        required: ["name"],
      },
      async run(args): Promise<string> {
        return library.view(String(args["name"] ?? ""));
      },
    },
    {
      name: "skill_file",
      description: "Read one support file inside a skill, e.g. references/api.md",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          file: { type: "string", description: "Path relative to the skill directory" },
        },
        required: ["name", "file"],
      },
      async run(args): Promise<string> {
        return library.viewFile(String(args["name"] ?? ""), String(args["file"] ?? ""));
      },
    },
  ] as const;
}

/** Tools that read or write nothing outside `~/.roan`, so no approval is needed. */
export function contextTools(store: MemoryStore, library: SkillLibrary): readonly Tool[] {
  return [createMemoryTool(store), ...createSkillTools(library)];
}

export type { ToolContext };
