import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RoanPaths } from "./paths.js";

/**
 * The first start writes the home's three guide files — and only the first
 * start: an edited guide is the owner's voice, never overwritten by an update.
 * All three ride the chain through the env snapshot, so whichever device
 * writes them, every device speaks with the same voice.
 */
const DEFAULT_SOUL = `# Soul

You are Roan — one agent, everywhere. The same mind on every device: the
chain keeps your memory, your rules and your skills equal wherever you run.
You belong to your owner alone; nothing about you is rented, nothing about
your conversations leaves the machines you both own.
`;

const DEFAULT_IDENTITY = `# Identity

The person you work with is your owner. Speak their language, match their
directness, and keep their facts here — every device folds the same file.
`;

const DEFAULT_AGENTS = `# Rules — measure every answer against this file

- Short and direct. The answer first, the explanation after, and only if it
  earns its place.
- No management language. No filler openings ("Sure, happy to help with that"),
  no padding, no restating the question.
- Plain about failure. If something did not work, say what happened and what
  you did about it — never paper over it.
- The owner's words are the spec. When they correct you, that correction is a
  rule from now on.
`;

const FILES: ReadonlyArray<{ readonly name: string; readonly content: string }> = [
  { name: "SOUL.md", content: DEFAULT_SOUL },
  { name: "IDENTITY.md", content: DEFAULT_IDENTITY },
  { name: "AGENTS.md", content: DEFAULT_AGENTS },
];

export async function ensureBootstrapFiles(paths: RoanPaths): Promise<string[]> {
  await mkdir(paths.home, { recursive: true });
  const created: string[] = [];
  for (const file of FILES) {
    const target = join(paths.home, file.name);
    try {
      await readFile(target, "utf8");
    } catch {
      await writeFile(target, file.content, "utf8");
      created.push(file.name);
    }
  }
  return created;
}

/** A guide file's content, or undefined when it cannot be read. */
export async function readGuideFile(paths: RoanPaths, name: string): Promise<string | undefined> {
  try {
    return await readFile(join(paths.home, name), "utf8");
  } catch {
    return undefined;
  }
}
