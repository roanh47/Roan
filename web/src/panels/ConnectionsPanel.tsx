import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Connections: the outside services Roan can use.
 *
 * A connection is an MCP server — the service's own description of what Roan
 * can do with it. A connection and its sign-in are shared with all your
 * devices, like everything else: connect a service once and every device can
 * use it.
 */
interface Connection {
  id: string;
  label: string;
  transport: string;
  address: string;
  enabled: boolean;
  signedIn: boolean;
  tools: number;
  connected: boolean;
  problem: string | null;
}

interface Answer {
  ok?: boolean;
  error?: string;
  connections?: Connection[];
}

/** Services known to accept a personal token as the sign-in. */
export const KNOWN_SERVICES: readonly { id: string; label: string; url: string; tokenHint: string }[] = [
  { id: "github", label: "GitHub", url: "https://api.githubcopilot.com/mcp/", tokenHint: "A personal access token from GitHub → Settings → Developer settings" },
  { id: "linear", label: "Linear", url: "https://mcp.linear.app/mcp", tokenHint: "An API key from Linear → Settings → Security & access" },
  { id: "stripe", label: "Stripe", url: "https://mcp.stripe.com", tokenHint: "A restricted API key from the Stripe dashboard" },
  { id: "huggingface", label: "Hugging Face", url: "https://huggingface.co/mcp", tokenHint: "An access token from Hugging Face → Settings → Access Tokens" },
];

/** A name the daemon accepts as an id, made from what the owner typed. */
export function connectionIdFrom(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function ConnectionsPanel({ client }: { client: ChainClient }): ReactElement {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const take = useCallback((answer: Answer, done: string | null): void => {
    if (answer.ok === true) {
      setConnections(answer.connections ?? []);
      setStatus(done);
    } else setStatus(answer.error ?? "that did not work");
  }, []);

  const refresh = useCallback(
    (done: string | null = null): Promise<void> =>
      client
        .request<Answer>("connections_list")
        .then((answer) => take(answer, done))
        .catch(() => setStatus("could not read the connections")),
    [client, take],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(id: string, name: string, address: string, token: string): Promise<void> {
    if (id.length === 0 || address.trim().length === 0) {
      setStatus("A connection needs a name and an address.");
      return;
    }
    setBusy(true);
    try {
      const saved = await client.request<{ ok?: boolean; error?: string }>("mcp_server_save", {
        id,
        label: name,
        transport: "http",
        url: address.trim(),
      });
      if (saved.ok !== true) {
        setStatus(saved.error ?? "could not add the connection");
        return;
      }
      if (token.trim().length > 0) {
        take(await client.request<Answer>("connection_token_set", { id, token: token.trim() }), `${name} added`);
      } else {
        await refresh(`${name} added`);
      }
      setLabel("");
      setUrl("");
      setNewToken("");
    } catch {
      setStatus("could not add the connection");
    } finally {
      setBusy(false);
    }
  }

  function signIn(connection: Connection): void {
    const token = (tokens[connection.id] ?? "").trim();
    if (token.length === 0) return;
    setBusy(true);
    void client
      .request<Answer>("connection_token_set", { id: connection.id, token })
      .then((answer) => {
        take(answer, `signed in to ${connection.label}`);
        setTokens((current) => ({ ...current, [connection.id]: "" }));
      })
      .catch(() => setStatus("could not save the token"))
      .finally(() => setBusy(false));
  }

  function signOut(connection: Connection): void {
    void client
      .request<Answer>("connection_token_clear", { id: connection.id })
      .then((answer) => take(answer, `signed out of ${connection.label}`))
      .catch(() => setStatus("could not sign out"));
  }

  function remove(connection: Connection): void {
    void client
      .request<{ ok?: boolean; error?: string }>("mcp_server_delete", { id: connection.id })
      .then(async (answer) => {
        if (answer.ok !== true) {
          setStatus(answer.error ?? "could not remove the connection");
          return;
        }
        await refresh(`${connection.label} removed`);
      })
      .catch(() => setStatus("could not remove the connection"));
  }

  const existing = new Set((connections ?? []).map((connection) => connection.id));
  const suggestions = KNOWN_SERVICES.filter((service) => !existing.has(service.id));

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Connections</h2>
      </header>
      <p className="panel__sub">
        Services Roan can use for you. Connect one here and all your devices can use it.
      </p>
      {status !== null ? <p className="panel__status">{status}</p> : null}

      <ul className="panel__list">
        {(connections ?? []).map((connection) => (
          <li key={connection.id} className="panel__item">
            <span className="panel__path">{connection.label}</span>
            <span className="panel__sub">
              {connection.problem !== null
                ? `Not connected — ${connection.problem}`
                : connection.tools > 0
                  ? `Connected · ${String(connection.tools)} tools`
                  : connection.enabled
                    ? "Connecting…"
                    : "Switched off"}
              {connection.signedIn ? " · signed in" : ""}
            </span>
            <span className="panel__sub">{connection.address}</span>
            {connection.transport === "http" ? (
              <input
                className="panel__input"
                type="password"
                aria-label={`Token for ${connection.label}`}
                placeholder={connection.signedIn ? "Paste a new token to replace the saved one" : "Paste your token to sign in"}
                value={tokens[connection.id] ?? ""}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setTokens((current) => ({ ...current, [connection.id]: event.target.value }))}
              />
            ) : null}
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {connection.transport === "http" ? (
                <button
                  type="button"
                  className="panel__primary"
                  disabled={busy || (tokens[connection.id] ?? "").trim().length === 0}
                  onClick={() => signIn(connection)}
                >
                  Sign in
                </button>
              ) : null}
              {connection.signedIn ? (
                <button type="button" className="panel__secondary" onClick={() => signOut(connection)}>
                  Sign out
                </button>
              ) : null}
              <button type="button" className="panel__secondary" onClick={() => remove(connection)}>
                Remove
              </button>
            </span>
          </li>
        ))}
        {connections === null ? <li className="panel__empty">Loading…</li> : null}
        {connections !== null && connections.length === 0 ? (
          <li className="panel__empty">No connections yet. Add one below.</li>
        ) : null}
      </ul>

      {suggestions.length > 0 ? (
        <div className="panel__form">
          <span className="panel__path">Add a service</span>
          {suggestions.map((service) => (
            <span key={service.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                type="button"
                className="panel__secondary"
                disabled={busy}
                onClick={() => void add(service.id, service.label, service.url, "")}
              >
                Add {service.label}
              </button>
              <span className="panel__sub">Sign-in: {service.tokenHint}.</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="panel__form">
        <span className="panel__path">Add another service</span>
        <span className="panel__sub">
          Any service that offers an MCP address and accepts a token. Services that only offer a browser sign-in
          cannot be added yet.
        </span>
        <input
          className="panel__input"
          aria-label="Connection name"
          placeholder="Name, for example Notes"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <input
          className="panel__input"
          aria-label="Connection address"
          placeholder="Address, for example https://example.com/mcp"
          value={url}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setUrl(event.target.value)}
        />
        <input
          className="panel__input"
          type="password"
          aria-label="Connection token"
          placeholder="Token (optional)"
          value={newToken}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setNewToken(event.target.value)}
        />
        <button
          type="button"
          className="panel__primary"
          disabled={busy || connectionIdFrom(label).length === 0 || url.trim().length === 0}
          onClick={() => void add(connectionIdFrom(label), label.trim(), url, newToken)}
        >
          Add connection
        </button>
      </div>
    </section>
  );
}

export default ConnectionsPanel;
