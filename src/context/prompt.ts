/**
 * What the agent knows before the first message of a turn.
 *
 * The order matters: who it is, then who the person is, then what it has
 * learned, then the list of skills it may open. Everything below the base
 * prompt is empty unless there is something to say, so a fresh install reads
 * as one paragraph instead of five headers with nothing under them.
 */
export interface PromptParts {
  readonly base: string;
  readonly user?: string;
  readonly memory?: string;
  readonly skills?: string;
}

export function buildSystemPrompt(parts: PromptParts): string {
  const blocks: string[] = [parts.base.trim()];

  if (parts.user !== undefined && parts.user.trim().length > 0) {
    blocks.push(
      `# Who you are working with\n\n${parts.user.trim()}\n\n` +
        `These are facts about this person, kept across sessions. Update them with ` +
        `the memory tool when you learn something that will still matter later.`,
    );
  }

  if (parts.memory !== undefined && parts.memory.trim().length > 0) {
    blocks.push(
      `# What you have learned\n\n${parts.memory.trim()}\n\n` +
        `Notes you wrote yourself. Keep them short and true; a note that is wrong ` +
        `is worse than no note.`,
    );
  }

  if (parts.skills !== undefined && parts.skills.trim().length > 0) {
    blocks.push(
      `# Skills\n\nLoad one with skill_view before a task it covers; do not guess at ` +
        `the procedure from the description alone.\n\n${parts.skills.trim()}`,
    );
  }

  return blocks.filter((block) => block.length > 0).join("\n\n");
}
