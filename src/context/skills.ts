import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Skills are instructions the agent reads only when a task calls for them.
 *
 * A skill is a directory under `~/.roan/skills` with a `SKILL.md` in it. The
 * frontmatter says what it is for; that one line is all the agent carries in
 * its prompt. The body is loaded on demand, so ten skills that are each a page
 * long cost the context almost nothing until one is actually used.
 */
export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly dir: string;
  /** Support files next to SKILL.md, relative to the skill directory. */
  readonly files: readonly string[];
}

interface Frontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly body: string;
}

/** Reads `---` fenced key/value pairs. Deliberately small: two keys, no nesting. */
export function parseFrontmatter(raw: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) return { body: raw };
  const head = match[1] ?? "";
  const body = match[2] ?? "";
  const values: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (pair === null) continue;
    const key = pair[1];
    const value = pair[2];
    if (key === undefined || value === undefined) continue;
    values[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return {
    ...(values["name"] !== undefined ? { name: values["name"] } : {}),
    ...(values["description"] !== undefined ? { description: values["description"] } : {}),
    body,
  };
}

export class SkillLibrary {
  constructor(private readonly root: string) {}

  /** Every skill on disk, sorted by name. A broken skill is skipped, not fatal. */
  async list(): Promise<readonly SkillSummary[]> {
    let names: string[];
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const found: SkillSummary[] = [];
    for (const name of names.sort()) {
      const dir = path.join(this.root, name);
      let raw: string;
      try {
        raw = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(raw);
      found.push({
        name: parsed.name ?? name,
        description: parsed.description ?? "",
        dir,
        files: await this.files(dir),
      });
    }
    return found;
  }

  /** The one-line-per-skill block the system prompt carries. */
  async index(): Promise<string> {
    const all = await this.list();
    return all.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  }

  /** The whole skill, plus a note about which files came with it. */
  async view(name: string): Promise<string> {
    const found = (await this.list()).find((skill) => skill.name === name);
    if (found === undefined) {
      const known = (await this.list()).map((skill) => skill.name).join(", ");
      throw new Error(`no skill "${name}"${known.length > 0 ? `; there are: ${known}` : ""}`);
    }
    return readSkillFile(found);
  }

  /** One support file inside a skill, e.g. `references/api.md`. */
  async viewFile(name: string, file: string): Promise<string> {
    const found = (await this.list()).find((skill) => skill.name === name);
    if (found === undefined) throw new Error(`no skill "${name}"`);
    if (!found.files.includes(file)) {
      throw new Error(`${file} is not part of "${name}"; available: ${found.files.join(", ")}`);
    }
    return readSkillFile(found, file);
  }

  private async files(dir: string): Promise<readonly string[]> {
    const out: string[] = [];
    async function walk(current: string, prefix: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === "SKILL.md") continue;
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
        else out.push(rel);
      }
    }
    await walk(dir, "");
    return out.sort();
  }
}

async function readSkillFile(skill: SkillSummary, file?: string): Promise<string> {
  const target = file === undefined ? path.join(skill.dir, "SKILL.md") : path.join(skill.dir, file);
  const raw = await fs.readFile(target, "utf8");
  if (file !== undefined) return raw;
  const parsed = parseFrontmatter(raw);
  const trailer =
    skill.files.length === 0
      ? ""
      : `\n\nFiles with this skill (read with skill_file): ${skill.files.join(", ")}`;
  return `${parsed.body.trim()}${trailer}`;
}
