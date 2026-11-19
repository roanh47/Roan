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
  /** SOUL.md: who this agent is. Present from the first start, home-grown. */
  readonly soul?: string;
  /** AGENTS.md: how this agent writes — a rule, not a suggestion. */
  readonly rules?: string;
  readonly user?: string;
  readonly memory?: string;
  readonly skills?: string;
}

export function buildSystemPrompt(parts: PromptParts): string {
  const blocks: string[] = [parts.base.trim()];

  if (parts.soul !== undefined && parts.soul.trim().length > 0) {
    blocks.push(
      `# Who you are\n\n${parts.soul.trim()}\n\n` +
        `This is the same on every device in the chain; it is you, not a costume.`,
    );
  }

  if (parts.rules !== undefined && parts.rules.trim().length > 0) {
    blocks.push(
      `# How you write — a rule, not a suggestion\n\n${parts.rules.trim()}\n\n` +
        `Every answer is measured against this block. An answer that breaks it is ` +
        `wrong even when its facts are right.`,
    );
  }

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

  // Fast models with tools attached will reach for a tool on any message,
  // including "Hi" — and a tool loop ends a turn in silence. The guard sits in
  // every prompt, fresh install or not, so small talk stays small talk.
  blocks.push(
    `# Tools\n\n` +
      `Tools are for work, not conversation. A greeting or a simple question gets ` +
      `a direct answer with no tool call at all. Do not call a tool to acknowledge ` +
      `or remember small talk; call one when the person asks for something to be ` +
      `done, read or checked.`,
  );

  return blocks.filter((block) => block.length > 0).join("\n\n");
}
