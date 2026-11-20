import { useCallback, useEffect, useState, type ChangeEvent, type ReactElement } from "react";

import type { ChainClient } from "../chain.js";

/** What the daemon says one tool is, in the per-tool screen. */
export interface ToolState {
  name: string;
  source: string;
  enabled: boolean;
  ask: boolean;
  approved: boolean;
}

/** One MCP server as the chain folds it, plus whether it answers right now. */
export interface ServerState {
  id: string;
  label: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  enabled: boolean;
  live: boolean;
}

interface ToolsPanelProps {
  client: ChainClient;
}

/**
 * The per-tool screen: every tool the model could reach, what the chain says
 * about it, and the MCP fleet behind the extra ones. Rules are chain events,
 * so a rule set here holds on every device.
 */
export function ToolsPanel({ client }: ToolsPanelProps): ReactElement {
  const [tools, setTools] = useState<ToolState[]>([]);
  const [servers, setServers] = useState<ServerState[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const refresh = useCallback((): void => {
    void client
      .request<{ ok?: boolean; tools?: ToolState[]; servers?: ServerState[] }>("tools_state")
      .then((answer) => {
        setTools(answer.tools ?? []);
        setServers(answer.servers ?? []);
        setNote(null);
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "no answer from the daemon"));
  }, [client]);

  useEffect(refresh, [refresh]);

  function setRule(tool: string, patch: { enabled?: boolean; ask?: boolean }): void {
    void client
      .request("tool_rule", { tool, ...patch })
      .then(refresh)
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "the rule did not stick"));
  }

  function resetApproval(tool: string): void {
    void client
      .request("tool_approval_reset", { tool })
      .then(refresh)
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "the reset did not stick"));
  }

  function addServer(event: ChangeEvent<HTMLFormElement>): void {
    event.preventDefault();
    const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (id.length === 0 || url.trim().length === 0) {
      setNote("a label and an url are required");
      return;
    }
    void client
      .request("mcp_server_save", { id, label: label.trim(), transport: "http", url: url.trim(), enabled: true })
      .then(() => {
        setLabel("");
        setUrl("");
        setFormOpen(false);
        return refresh();
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "the server did not save"));
  }

  function toggleServer(server: ServerState): void {
    void client
      .request("mcp_server_save", {
        id: server.id,
        label: server.label,
        transport: server.transport,
        ...(server.url !== undefined ? { url: server.url } : {}),
        ...(server.command !== undefined ? { command: server.command } : {}),
        enabled: !server.enabled,
      })
      .then(refresh)
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "the change did not stick"));
  }

  function removeServer(server: ServerState): void {
    void client
      .request("mcp_server_delete", { id: server.id })
      .then(refresh)
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "the removal did not stick"));
  }

  return (
    <section className="panel">
      <h2 className="panel__title">Tools</h2>
      <p className="panel__intro">
        Rules live in the chain: a tool turned off here stays off everywhere, and an approved tool stops asking.
      </p>
      {note !== null ? <p className="panel__note">{note}</p> : null}
      <button type="button" className="panel__refresh" onClick={refresh}>
        Refresh
      </button>
      <ul className="panel__list">
        {tools.map((tool) => (
          <li key={tool.name} className="toolrow">
            <span className="toolrow__name">{tool.name}</span>
            <span className="toolrow__source">{tool.source}</span>
            <label className="toolrow__toggle">
              <input
                type="checkbox"
                checked={tool.enabled}
                onChange={() => setRule(tool.name, { enabled: !tool.enabled })}
              />
              on
            </label>
            <label className="toolrow__toggle">
              <input type="checkbox" checked={tool.ask} onChange={() => setRule(tool.name, { ask: !tool.ask })} />
              ask first
            </label>
            {tool.approved ? (
              <span className="toolrow__approved">
                approved
                <button type="button" onClick={() => resetApproval(tool.name)}>
                  reset
                </button>
              </span>
            ) : null}
          </li>
        ))}
        {tools.length === 0 ? <li className="panel__empty">No tools listed yet — refresh.</li> : null}
      </ul>

      <h2 className="panel__title">MCP servers</h2>
      <p className="panel__intro">A server is chain config too: every instance dials the same list.</p>
      <ul className="panel__list">
        {servers.map((server) => (
          <li key={server.id} className="toolrow">
            <span className="toolrow__name">{server.label}</span>
            <span className="toolrow__source">
              {server.transport === "http" ? server.url : server.command}
              {server.enabled ? (server.live ? " · live" : " · unreachable") : " · off"}
            </span>
            <label className="toolrow__toggle">
              <input type="checkbox" checked={server.enabled} onChange={() => toggleServer(server)} />
              on
            </label>
            <button type="button" className="toolrow__remove" onClick={() => removeServer(server)}>
              remove
            </button>
          </li>
        ))}
        {servers.length === 0 ? <li className="panel__empty">No MCP servers yet.</li> : null}
      </ul>
      {formOpen ? (
        <form className="panel__form" onSubmit={addServer}>
          <label>
            Label
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Bewijsserver" />
          </label>
          <label>
            URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:9701/mcp" />
          </label>
          <button type="submit" className="panel__cta">
            Save server
          </button>
        </form>
      ) : (
        <button type="button" className="panel__cta" onClick={() => setFormOpen(true)}>
          Add MCP server
        </button>
      )}
    </section>
  );
}
