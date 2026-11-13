import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ChainClient, openTurn } from "./chain";
import { Composer } from "./components/Composer";
import { WorkspacePanel } from "./panels/WorkspacePanel";
import { SchedulesPanel } from "./panels/SchedulesPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { CheckpointsPanel } from "./panels/CheckpointsPanel";
import { Transcript } from "./components/Transcript";
import { TurnStatus } from "./components/TurnStatus";

/**
 * The shell (Tauri / Android) injects this before the bundle runs:
 *   window.__ROAN__ = { socket: "ws://127.0.0.1:7411/ws", node: "roan-pc" }
 *
 * There is no public address and no token here: the daemon listens on loopback
 * on the same device, and the app is the only client. If the daemon moves to a
 * unix socket, the shell proxies it and only this value changes.
 */
interface HostBridge {
  socket?: string;
  node?: string;
}

const host = (globalThis as typeof globalThis & { __ROAN__?: HostBridge }).__ROAN__;
/**
 * Where the daemon is. On the web build that is the server that served this
 * page; in the desktop app it is this machine; on a phone it is the machine you
 * named yourself, because a phone has no daemon of its own.
 */
function resolveSocketUrl(fallback: string | undefined): string {
  try {
    const stored = window.localStorage.getItem("roan.daemon");
    if (stored !== null && stored.trim().length > 0) return stored.trim();
  } catch {
    // storage can be blocked; the defaults below still work
  }
  if (fallback !== undefined) return fallback;
  const { protocol, hostname } = window.location;
  if ((protocol === "http:" || protocol === "https:") && hostname.includes(".")) {
    return `${protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  }
  return "ws://127.0.0.1:7411/ws";
}

const SOCKET_URL = resolveSocketUrl(host?.socket);

function deviceNode(): string {
  if (host?.node) return host.node;
  try {
    const saved = localStorage.getItem("roan.node");
    if (saved) return saved;
    const generated = `device-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem("roan.node", generated);
    return generated;
  } catch {
    return "device";
  }
}

const NODE = deviceNode();


export default function App(): ReactElement {
  const client = useMemo(() => new ChainClient({ url: SOCKET_URL, node: NODE }), []);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const turn = useMemo(() => openTurn(snapshot.events), [snapshot.events]);
  const activeSession = snapshot.activeSession ?? snapshot.sessions.at(-1)?.id ?? null;
  // Only one conversation is on screen; the rest of the chain stays where it is.
  const visible = useMemo(() => {
    if (activeSession === null) return snapshot.events;
    // Messages from before sessions existed belong to the oldest one, not to
    // everything: otherwise every new conversation shows the whole chain.
    const firstSession = snapshot.sessions[0]?.id;
    const scoped = new Set(["message", "assistant", "error", "checkpoint", "workspace"]);
    return snapshot.events.filter((event) => {
      const data = event.data as { session?: unknown; id?: unknown } | null;
      if (event.type === "session") return data?.id === activeSession;
      if (!scoped.has(event.type)) return true;
      const owner = typeof data?.session === "string" ? data.session : firstSession;
      return owner === activeSession;
    });
  }, [snapshot.events, activeSession, snapshot.sessions]);

  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"chat" | "workspace" | "schedules" | "checkpoints" | "settings">("chat");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const blocked = snapshot.status !== "open";
  const disabled = blocked || turn !== null;

  const placeholder = turn
    ? `${turn.owner} is working…`
    : blocked
      ? "Waiting for the daemon…"
      : "Message Roan";

  function send(text: string): void {
    try {
      client.sendMessage(text, activeSession);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The message could not be sent.");
    }
  }

  const onboarded = snapshot.chain !== null && snapshot.chain !== "";

  if (!onboarded) {
    return (
      <div className="app app--onboarding">
        <header className="titlebar" data-tauri-drag-region>
          <div className="titlebar__brand" data-tauri-drag-region>
            <span className="titlebar__mark" aria-hidden="true" data-tauri-drag-region />
            <span className="titlebar__name" data-tauri-drag-region>
              Roan
            </span>
          </div>
          <span className="titlebar__chain" data-tauri-drag-region>
            {snapshot.status === "open" ? "no chain yet" : "connecting…"}
          </span>
        </header>

        <main className="onboarding">
          <h1 className="onboarding__title">Start on this device</h1>
          <p className="onboarding__text">
            A chain is the conversation and everything around it. Create one here,
            or join one that already exists — joining takes the chain's history as
            your own.
          </p>

          <button
            type="button"
            className="onboarding__primary"
            disabled={snapshot.status !== "open"}
            onClick={() => {
              try {
                client.createChain();
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "could not create a chain");
              }
            }}
          >
            Create a new chain
          </button>

          <div className="onboarding__sep" aria-hidden="true">
            or
          </div>

          <label className="onboarding__label" htmlFor="join-code">
            Join an existing chain
          </label>
          <div className="onboarding__row">
            <input
              id="join-code"
              className="onboarding__input"
              value={joinCode}
              placeholder="paste the code from the other device"
              onChange={(event) => setJoinCode(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="onboarding__secondary"
              disabled={snapshot.status !== "open" || joinCode.trim().length === 0}
              onClick={() => {
                try {
                  client.joinChain(joinCode);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "could not join");
                }
              }}
            >
              Join
            </button>
          </div>

          {snapshot.invite !== null ? (
            <div className="onboarding__invite">
              <span className="onboarding__label">Code for the next device</span>
              <code className="onboarding__code">{snapshot.invite}</code>
            </div>
          ) : null}

          {snapshot.error !== null ? <p className="onboarding__error">{snapshot.error}</p> : null}
          {notice !== null ? <p className="onboarding__error">{notice}</p> : null}

          <p className="onboarding__hint">
            {snapshot.status === "open"
              ? "The daemon is running on this machine."
              : "Waiting for the daemon on this machine to answer."}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__brand" data-tauri-drag-region>
          <span className="titlebar__mark" aria-hidden="true" data-tauri-drag-region />
          <span className="titlebar__name" data-tauri-drag-region>
            Roan
          </span>
        </div>
        <span className="titlebar__title" data-tauri-drag-region>
          {view === "chat"
            ? (snapshot.sessions.find((entry) => entry.id === activeSession)?.title ?? "New conversation")
            : view === "workspace"
              ? "Workspace"
              : view === "schedules"
                ? "Schedules"
                : view === "checkpoints"
                  ? "Checkpoints"
                  : "Settings"}
        </span>
        {snapshot.model !== undefined ? (
          <span className="titlebar__model" title={snapshot.chain ?? undefined}>
            {snapshot.model}
          </span>
        ) : null}
        <button
          type="button"
          className="titlebar__menu"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ☰
        </button>
      </header>

      <main className={view === "chat" ? "conversation" : "conversation conversation--panel"} aria-label="Conversation">
        {view === "chat" ? (
          <Transcript events={visible} pending={snapshot.pending} node={snapshot.node} />
        ) : null}
        {view === "workspace" ? <WorkspacePanel client={client} /> : null}
        {view === "schedules" ? <SchedulesPanel client={client} /> : null}
        {view === "checkpoints" ? (
          <CheckpointsPanel
            client={client}
            onRewind={(seq) => {
              client.rewind(seq);
              setView("chat");
            }}
          />
        ) : null}
        {view === "settings" ? <SettingsPanel client={client} current={snapshot.model ?? "onbekend"} /> : null}
      </main>

      {menuOpen ? (
        <button
          type="button"
          className="rail__scrim"
          aria-label="Sluit menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className={menuOpen ? "rail rail--open" : "rail"}>
        <nav className="rail__nav">
          {(
            [
              ["chat", "Conversations"],
              ["workspace", "Workspace"],
              ["schedules", "Schedules"],
              ["checkpoints", "Checkpoints"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "rail__navitem rail__navitem--active" : "rail__navitem"}
              onClick={() => {
                setView(id);
                setMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="rail__sessions">
          <div className="rail__row">
            <span className="onboarding__label">Conversations</span>
            <button
              type="button"
              className="rail__button"
              disabled={disabled}
              onClick={() => {
                client.newSession();
                setMenuOpen(false);
              }}
            >
              New
            </button>
          </div>
          <ul className="rail__list">
            {snapshot.sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={
                    session.id === activeSession ? "rail__session rail__session--active" : "rail__session"
                  }
                  onClick={() => {
                    client.selectSession(session.id);
                    setMenuOpen(false);
                  }}
                  title={`${session.title} — ${String(session.messages)} messages`}
                >
                  {session.title}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {snapshot.invite !== null ? (
          <div className="onboarding__invite">
            <span className="onboarding__label">Code for the next device</span>
            <code className="onboarding__code">{snapshot.invite}</code>
          </div>
        ) : null}
        <TurnStatus
          turn={turn}
          status={snapshot.status}
          chain={snapshot.chain}
          node={snapshot.node}
          peer={snapshot.peer}
          pending={snapshot.pending.length}
          lastSeq={snapshot.lastSeq}
          error={snapshot.error}
          notice={notice}
        />
      </aside>

      <footer className={view === "chat" ? "dock" : "dock dock--hidden"}>
        <Composer disabled={disabled} placeholder={placeholder} onSend={send} />
      </footer>
    </div>
  );
}
