import { commandList, foldCommands, type CommandEventLike } from "../../src/chain/commands.js";
import type { SlashCommand } from "./components/SlashMenu.js";

/**
 * What the composer offers after a slash.
 *
 * The slash menu is a shortcut, never the only way: everything it does has a
 * button or a screen. Two kinds share it: a few jumps the app answers itself,
 * and the owner's own commands — prompts made in Settings → Commands, stored
 * in the chain and expanded by the daemon when sent.
 */

/** Answered by the app. A chain command with the same name stays hidden. */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  { name: "new", description: "Start a new chat" },
  { name: "model", description: "Choose the provider and model" },
  { name: "plan", description: "Turn plan mode on, or approve the plan" },
  { name: "sessions", description: "Open the list of chats" },
  { name: "settings", description: "Open settings" },
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
