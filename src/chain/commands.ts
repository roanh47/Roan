/**
 * Slash commands: a short word the owner types, and the prompt it stands for.
 *
 * A person writes `/review the parser` and the turn runs what `/review` was
 * defined to say, with what they typed filled in. The definitions travel in the
 * chain as `command` events, so every device resolves the same name to the same
 * prompt and a command learned on one machine works on the others.
 *
 * Everything here is pure: text in, a value out. No store, no clock, no spawn.
 */

/** A slash line split into the word and everything after it. */
export interface ParsedCommand {
  readonly name: string;
  /** The text after the name, trimmed; empty string when nothing followed. */
  readonly args: string;
}

/** One command definition, as folded from the chain. */
export interface CommandDefinition {
  readonly name: string;
  readonly prompt: string;
}

/** The minimum a fold needs; the chain's `Event` and the web client's satisfy it. */
export interface CommandEventLike {
  readonly type: string;
  readonly data: unknown;
}

/** What a prompt says where the typed arguments belong. */
export const COMMAND_PLACEHOLDER = "$args";

/**
 * A command name is one word: letters, digits, `_`, `-` and `.`. A slash, a
 * space or punctuation is not a name — `/foo/bar` is a bad command line, not a
 * command called `foo/bar`.
 */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A name we would accept from the chain, or null. */
function commandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return NAME.test(name) ? name : null;
}

/**
 * Reads a line the owner typed as a command, or null when it is not one.
 *
 * The leading slash is required and the name is the first word after it: `"/ "`
 * names nothing and is refused, and a name is always a single word, so
 * everything after the first space is `args`. Text that does not start with a
 * slash is ordinary message text, never an error.
 */
export function parseCommandLine(text: string): ParsedCommand | null {
  // Leading whitespace is the composer's padding, not part of the command.
  const line = text.replace(/^\s+/, "");
  if (!line.startsWith("/")) return null;

  const body = line.slice(1);
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  if (!NAME.test(name)) return null;

  const args = separator === -1 ? "" : body.slice(separator).trim();
  return { name, args };
}

/**
 * The commands in the chain, newest definition per name winning.
 *
 * A `command` event with `removed: true` is a tombstone: the name stops being a
 * command, but the earlier definitions stay in the chain. A malformed payload
 * — no usable name, no prompt — is skipped rather than guessed at, and a
 * tombstone for a name that was never defined is a quiet no-op.
 */
export function foldCommands(
  events: readonly CommandEventLike[],
): Map<string, CommandDefinition> {
  const byName = new Map<string, CommandDefinition>();

  for (const event of events) {
    if (event.type !== "command") continue;
    const data = asRecord(event.data);
    if (data === null) continue;
    const name = commandName(data["name"]);
    if (name === null) continue;

    if (data["removed"] === true) {
      byName.delete(name);
      continue;
    }

    const prompt = typeof data["prompt"] === "string" ? data["prompt"] : null;
    if (prompt === null || prompt.trim().length === 0) continue;

    byName.set(name, { name, prompt });
  }

  return byName;
}

/** The folded commands as a list, sorted by name for a menu that stays put. */
export function commandList(
  commands: ReadonlyMap<string, CommandDefinition>,
): CommandDefinition[] {
  return [...commands.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * What a typed line means for the turn: the prompt the model gets, and the
 * line as typed when the two differ.
 *
 * Only a line that names a command the chain defines is expanded. Anything
 * else — ordinary text, a path like `/etc`, a typo — is the owner's own words
 * and reaches the model unchanged; guessing would be worse than passing it on.
 */
export function resolveMessage(
  text: string,
  events: readonly CommandEventLike[],
): { readonly prompt: string; readonly typed?: string } {
  const parsed = parseCommandLine(text);
  if (parsed === null) return { prompt: text };
  const expansion = expandCommand(parsed.name, parsed.args, foldCommands(events));
  if (!expansion.ok || expansion.prompt === text) return { prompt: text };
  return { prompt: expansion.prompt, typed: text };
}

/**
 * The prompt a command stands for, or a reason it cannot be expanded.
 *
 * With `$args` in the prompt the typed text takes its place; without it the
 * text rides along after a blank line, because dropping what the owner typed
 * silently would be worse than a slightly longer prompt. An unknown name is an
 * error, not an empty prompt: a typo must not turn into a turn with no
 * instructions.
 */
export type CommandExpansion =
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly error: string };

export function expandCommand(
  name: string,
  args: string,
  commands: ReadonlyMap<string, CommandDefinition>,
): CommandExpansion {
  const wanted = name.trim();
  if (wanted.length === 0) return { ok: false, error: "no command name given" };

  const command = commands.get(wanted);
  if (command === undefined) {
    return { ok: false, error: `unknown command "/${wanted}"` };
  }

  const extra = args.trim();
  if (command.prompt.includes(COMMAND_PLACEHOLDER)) {
    return { ok: true, prompt: command.prompt.split(COMMAND_PLACEHOLDER).join(extra) };
  }
  if (extra.length === 0) return { ok: true, prompt: command.prompt };
  return { ok: true, prompt: `${command.prompt.trimEnd()}\n\n${extra}` };
}
