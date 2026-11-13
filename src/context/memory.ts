import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Memory is the part of the agent that survives the conversation.
 *
 * Two files, both plain text, both edited through one tool:
 *
 *   USER.md    who the person is  — facts about them, stable across tasks
 *   MEMORY.md  what the agent has learned — environment quirks, conventions
 *
 * Entries are separated by a blank line. The budget is a hard limit, checked on
 * the whole file after an edit: when it is full the agent must remove or
 * shorten something to fit, exactly like a person who keeps notes that matter.
 */
export const BUDGET = { user: 1375, memory: 2200 } as const;
export type MemoryTarget = keyof typeof BUDGET;

const FILES: Record<MemoryTarget, string> = { user: "USER.md", memory: "MEMORY.md" };

export interface MemoryEntry {
  readonly index: number;
  readonly text: string;
}

export class MemoryStore {
  constructor(private readonly root: string) {}

  path(target: MemoryTarget): string {
    return path.join(this.root, FILES[target]);
  }

  async read(target: MemoryTarget): Promise<string> {
    try {
      return await fs.readFile(this.path(target), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async entries(target: MemoryTarget): Promise<readonly MemoryEntry[]> {
    const raw = await this.read(target);
    return raw
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((text, index) => ({ index: index + 1, text }));
  }

  async add(target: MemoryTarget, text: string): Promise<number> {
    const entry = text.trim();
    if (entry.length === 0) throw new Error("nothing to remember: the entry is empty");
    const existing = await this.entries(target);
    if (existing.some((item) => item.text === entry)) return this.count(target);
    return this.write(target, [...existing.map((item) => item.text), entry]);
  }

  async replace(target: MemoryTarget, index: number, text: string): Promise<number> {
    const entry = text.trim();
    if (entry.length === 0) throw new Error("nothing to store: the entry is empty");
    const existing = await this.entries(target);
    if (!existing.some((item) => item.index === index)) {
      throw new Error(`no entry ${index}; there are ${existing.length}`);
    }
    return this.write(
      target,
      existing.map((item) => (item.index === index ? entry : item.text)),
    );
  }

  async remove(target: MemoryTarget, index: number): Promise<number> {
    const existing = await this.entries(target);
    if (!existing.some((item) => item.index === index)) {
      throw new Error(`no entry ${index}; there are ${existing.length}`);
    }
    return this.write(
      target,
      existing.filter((item) => item.index !== index).map((item) => item.text),
    );
  }

  /** Characters used, measured on the file as the agent will see it. */
  async count(target: MemoryTarget): Promise<number> {
    return (await this.read(target)).trim().length;
  }

  async budget(target: MemoryTarget): Promise<{ used: number; limit: number }> {
    return { used: await this.count(target), limit: BUDGET[target] };
  }

  /** The block the agent gets in its system prompt; empty when nothing is kept. */
  async render(target: MemoryTarget): Promise<string> {
    const entries = await this.entries(target);
    if (entries.length === 0) return "";
    return entries.map((entry, i) => `${i + 1}. ${entry.text}`).join("\n");
  }

  private async write(target: MemoryTarget, entries: readonly string[]): Promise<number> {
    const body = entries.map((entry) => entry.trim()).filter(Boolean).join("\n\n");
    const limit = BUDGET[target];
    if (body.length > limit) {
      const over = body.length - limit;
      throw new Error(
        `memory is full: ${body.length}/${limit} characters, ${over} over. ` +
          `Remove or shorten an entry first (list them to see the numbers).`,
      );
    }
    await fs.mkdir(this.root, { recursive: true });
    const file = this.path(target);
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, body.length === 0 ? "" : `${body}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
    return body.length;
  }
}
