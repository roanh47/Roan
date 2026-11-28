import { commandList, foldCommands, type CommandEventLike } from "../../src/chain/commands.js";
import type { SlashCommand } from "./components/SlashMenu.js";

/**
 * What the composer offers after a slash.
 *
 * Two kinds share one menu: commands the app answers itself (they open a
 * screen or flip a switch, no turn runs) and the owner's own commands, which
 * are prompts stored in the chain and expanded by the daemon when sent.
 */

/** Answered by the app. A chain command with the same name stays hidden. */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  { name: "new", description: "Start a new chat" },
  { name: "model", description: "Choose the provider and model" },
  { name: "plan", description: "Turn plan mode on, or approve the plan" },
  { name: "settings", description: "Open settings" },
  { name: "sessions", description: "Open the list of chats" },
  { name: "goal", description: "Give Roan a standing goal: /goal what to keep working toward" },
  { name: "vision", description: "Model that looks at images for a text-only main model: /vision model-id, or /vision off" },
  { name: "background", description: "Cheaper model for memory and other background work: /background model-id, or off" },
  { name: "fallback", description: "Model to retry on when the first fails: /fallback model-id, or /fallback off" },
  { name: "command", description: "Save your own: /command name prompt — no prompt removes it" },
];

const DESCRIPTION_LIMIT = 80;

/** The first line of a prompt, short enough for one menu row. */
function describePrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 1)}…` : line;
}

/** Built-ins first, then the chain's commands by name. */
export function slashCommands(events: readonly CommandEventLike[]): SlashCommand[] {
  const builtin = new Set(BUILTIN_COMMANDS.map((command) => command.name));
  const own = commandList(foldCommands(events))
    .filter((command) => !builtin.has(command.name))
    .map((command) => ({ name: command.name, description: describePrompt(command.prompt) }));
  return [...BUILTIN_COMMANDS, ...own];
}

/**
 * The command name being typed, or null when the draft is not one.
 *
 * The menu belongs to the moment between the slash and the first space: after
 * a space the owner is writing arguments, and a draft that starts with
 * anything else is ordinary text.
 */
export function slashPrefix(draft: string): string | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  return /\s/.test(rest) ? null : rest;
}

/** What `/command …` asks for: save a prompt under a name, or remove the name. */
export type CommandEdit =
  | { readonly ok: true; readonly name: string; readonly prompt: string | null }
  | { readonly ok: false; readonly error: string };

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

export function parseCommandEdit(args: string): CommandEdit {
  const text = args.trim();
  if (text.length === 0) return { ok: false, error: "Use /command name prompt" };
  const separator = text.search(/\s/);
  const name = (separator === -1 ? text : text.slice(0, separator)).replace(/^\//, "");
  if (!NAME.test(name)) return { ok: false, error: `"${name}" is not a usable command name` };
  if (BUILTIN_COMMANDS.some((command) => command.name === name)) {
    return { ok: false, error: `/${name} is built in and cannot be replaced` };
  }
  const prompt = separator === -1 ? "" : text.slice(separator).trim();
  return { ok: true, name, prompt: prompt.length === 0 ? null : prompt };
}
