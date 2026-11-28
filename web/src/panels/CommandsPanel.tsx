import { useMemo, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";
import { commandList, foldCommands, type CommandEventLike } from "../../../src/chain/commands.js";
import { BUILTIN_COMMANDS } from "../commands.js";

/**
 * Your own slash commands: a short word and the prompt it stands for.
 *
 * Saved here, typed in the composer as `/name`. They live in the chain, so a
 * command made on one device works on all of them.
 */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

export function CommandsPanel({
  client,
  events,
}: {
  client: ChainClient;
  events: readonly CommandEventLike[];
}): ReactElement {
  const commands = useMemo(() => commandList(foldCommands(events)), [events]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const cleanName = name.trim().replace(/^\//, "");
  const builtin = BUILTIN_COMMANDS.some((command) => command.name === cleanName);
  const problem =
    cleanName.length === 0
      ? null
      : !NAME.test(cleanName)
        ? "A name is one word: letters, digits, dots, dashes."
        : builtin
          ? `/${cleanName} is built in and cannot be replaced.`
          : null;
  const ready = cleanName.length > 0 && problem === null && prompt.trim().length > 0;

  function send(kind: "command_save" | "command_remove", data: Record<string, unknown>, done: string): void {
    void client
      .request<{ ok?: boolean; error?: string }>(kind, data)
      .then((answer) => setStatus(answer.ok === true ? done : (answer.error ?? "that did not save")))
      .catch(() => setStatus("that did not save"));
  }

  function save(): void {
    if (!ready) return;
    send("command_save", { name: cleanName, prompt: prompt.trim() }, `/${cleanName} saved`);
    setName("");
    setPrompt("");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Commands</h2>
      </header>
      <p className="panel__sub">
        Type <strong>/name</strong> in a message to send the prompt. Put <strong>$args</strong> in the prompt where
        the rest of your message should go.
      </p>
      {status !== null ? <p className="panel__status">{status}</p> : null}

      <div className="panel__form">
        <input
          className="panel__input"
          aria-label="Command name"
          placeholder="Name, for example review"
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        {problem !== null ? <p className="panel__status">{problem}</p> : null}
        <textarea
          className="panel__input panel__textarea"
          aria-label="Command prompt"
          placeholder="What Roan should do, for example: Review this carefully: $args"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="button" className="panel__primary" disabled={!ready} onClick={save}>
          Save command
        </button>
      </div>

      <ul className="panel__list">
        {commands.map((command) => (
          <li key={command.name} className="panel__item">
            <span className="panel__path">/{command.name}</span>
            <span className="panel__sub" style={{ whiteSpace: "pre-wrap" }}>
              {command.prompt}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="panel__secondary"
                onClick={() => {
                  setName(command.name);
                  setPrompt(command.prompt);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="panel__secondary"
                onClick={() => send("command_remove", { name: command.name }, `/${command.name} removed`)}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
        {commands.length === 0 ? <li className="panel__empty">No commands of your own yet.</li> : null}
      </ul>
    </section>
  );
}

export default CommandsPanel;
