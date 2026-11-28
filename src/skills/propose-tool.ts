import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types.js";
import { MAX_BODY_CHARS, MAX_DESCRIPTION_CHARS, normaliseSkillName, renderSkillFile, type SkillDraft } from "./parse.js";
import { proposalEvent, proposalId, type SkillProposalAppend } from "./proposal.js";

/**
 * How the agent improves itself: it proposes, a person decides.
 *
 * `skill_propose` only appends a proposal to the chain. Nothing reaches
 * `skills/` and nothing reaches a prompt until the owner approves it in the
 * app; `installSkill` is what the daemon runs at that moment. Proposing a name
 * that already exists is how a skill is updated: it is a new proposal with its
 * own id, so the old text stays in the chain and the new text waits for a yes.
 */

export interface ProposeToolOptions {
  /** Appends the proposal to the chain and tells the app. */
  readonly append: (event: SkillProposalAppend) => void;
  /** A short unique suffix, so two proposals for one name are two questions. */
  readonly newId: () => string;
}

export function createSkillProposeTool(options: ProposeToolOptions): Tool {
  return {
    name: "skill_propose",
    description:
      "Propose a new skill, or a better version of an existing one, for the owner to approve. " +
      "Use it after a task that took several steps or corrections and taught a procedure, rule " +
      "or machine quirk that will still be true next time. Write the steps in order, the commands " +
      "exactly as they worked and the traps that cost time. Not for one-off tasks. " +
      "Nothing is saved until the owner says yes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lower-case slug with hyphens; an existing name proposes an update" },
        description: { type: "string", description: "One line saying when to use the skill" },
        body: { type: "string", description: "The instructions, as markdown" },
      },
      required: ["name", "description", "body"],
    },
    async run(args): Promise<string> {
      const name = normaliseSkillName(args["name"]);
      if (name === null) throw new Error("name must be a slug of at least three letters, digits or hyphens");
      const body = typeof args["body"] === "string" ? args["body"].trim() : "";
      if (body.length === 0) throw new Error("body is empty: a skill needs its instructions");
      if (body.length > MAX_BODY_CHARS) {
        throw new Error(`body is ${String(body.length)} characters; the limit is ${String(MAX_BODY_CHARS)}`);
      }
      const description =
        typeof args["description"] === "string"
          ? args["description"].replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS)
          : "";
      if (description.length === 0) throw new Error("description is empty: say in one line when to use the skill");
      const draft: SkillDraft = { name, description, body };
      options.append(proposalEvent(draft, `${proposalId(name)}:${options.newId()}`));
      return `proposed skill "${name}"; it is saved only if the owner approves it in the app`;
    },
  };
}

/** Writes an approved skill to `<home>/skills/<name>/SKILL.md`; the env loop makes it travel. */
export async function installSkill(home: string, draft: SkillDraft): Promise<string> {
  const name = normaliseSkillName(draft.name);
  if (name === null) throw new Error(`cannot install a skill named "${draft.name}"`);
  const dir = path.join(home, "skills", name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  await fs.writeFile(file, renderSkillFile({ ...draft, name }), "utf8");
  return file;
}
