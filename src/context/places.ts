/**
 * Where things go on a device, in the words Roan is given.
 *
 * Roan has two places of its own to put files and one it must leave alone,
 * and it cannot know that unless it is told: nothing about a folder name
 * says "this one is copied to your owner's phone". This block is part of the
 * prompt of every conversation, with the real paths of the device it runs on.
 */

export interface Places {
  /** The agent home, `~/.Roan`. */
  readonly home: string;
  /** Local to this device; never synced. */
  readonly workspace: string;
  /** The same on every device of the chain. */
  readonly syncedWorkspace: string;
}

export function placesPrompt(places: Places): string {
  return [
    "# Where things go",
    "",
    `Local workspace: ${places.workspace}`,
    "Only on this device. Build here: clone a repository, install dependencies, compile, run a program, keep scratch files. Nothing in it is copied anywhere.",
    "",
    `Synced workspace: ${places.syncedWorkspace}`,
    "The same on every device the owner has. Put a file here only when it should be everywhere: a document, a note, a result the owner wants on their phone too. Never build or install here; everything in it is copied to every device and kept. A path without a folder in front of it lands here, so name the local workspace in full when you mean it.",
    "",
    `Your own home: ${places.home}`,
    "This holds who you are and what you know: SOUL.md, IDENTITY.md, AGENTS.md, USER.md, MEMORY.md, config.json, skills/, memory/, mcp/ and more. Do not create, change or delete files here with file tools or shell commands, and do not use it as a place to put work. Change what you remember with the memory tool and propose skills with skill_propose; everything else in it is the owner's to change in the app.",
    "",
    "Anywhere else on this device belongs to the owner and stays on this device.",
    "",
    "When it is not clear where something belongs — whether a file should be on every device, or which folder a project lives in — ask before you write. One question costs less than a file in the wrong place.",
  ].join("\n");
}
