import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ChainClient, openTurn, turnPhase, turnQuietMs } from "./chain.js";
import type { ChainSnapshot } from "./chain.js";
import pkg from "../package.json";
import { Composer } from "./components/Composer.js";
import { WorkspacePanel } from "./panels/WorkspacePanel.js";
import { UpdateCard } from "./panels/UpdateCard.js";
import { SchedulesPanel } from "./panels/SchedulesPanel.js";
import { GoalsPanel } from "./panels/GoalsPanel.js";
import { foldGoals } from "../../src/chain/goals.js";
import { ProvidersPanel } from "./panels/ProvidersPanel.js";
import { CapabilitiesPanel } from "./panels/CapabilitiesPanel.js";
import { ToolsPanel } from "./panels/ToolsPanel.js";
import { CheckpointsPanel } from "./panels/CheckpointsPanel.js";
import { Transcript } from "./components/Transcript.js";
import { ModelSheet } from "./components/ModelSheet.js";

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
 * page; in a native shell — desktop or phone — it is the daemon on this device,
 * which every instance runs for itself.
 */
function resolveSocketUrl(fallback: string | undefined): string {
  if (fallback !== undefined) return fallback;
  const { protocol, hostname } = window.location;
  // The native shell (desktop and phone) loads the bundle from tauri.localhost,
  // which is the app itself and serves nothing. The daemon on this device is on
  // loopback, so any page that came out of the shell talks to 127.0.0.1 — never
  // to the shell's own origin.
  if (hostname === "tauri.localhost" || protocol === "tauri:" || protocol === "ipc:") {
    return "ws://127.0.0.1:7411/ws";
  }
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

/** Settings is a menu, not a drawer full of panels: chat stays the app. */
type SettingsPage =
  | "menu"
  | "providers"
  | "agent"
  | "workspace"
  | "schedules"
  | "checkpoints"
  | "tools"
  | "devices"
  | "storage"
  | "about";

const SETTINGS_ROWS: readonly [SettingsPage, string, string][] = [
  ["providers", "Models & keys", "providers and API keys"],
  ["agent", "Agent", "tools, skills and MCP servers"],
  ["tools", "Tools & rules", "on or off, ask first, MCP servers"],
  ["workspace", "Workspace", "files shared across devices"],
  ["schedules", "Schedules", "tasks that run later"],
  ["checkpoints", "Checkpoints", "named points to rewind to"],
  ["devices", "Sync", "the chain, the nodes, the invite"],
  ["storage", "Storage window", "Android's files, next to the home"],
  ["about", "About", "chain, node and version"],
];

export default function App(): ReactElement {
  const client = useMemo(() => new ChainClient({ url: SOCKET_URL, node: NODE }), []);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const turn = useMemo(() => openTurn(snapshot.events), [snapshot.events]);
  const phase = useMemo(() => turnPhase(snapshot.events, turn), [snapshot.events, turn]);
  const activeSession = snapshot.activeSession ?? snapshot.sessions.at(-1)?.id ?? null;

  // Plan mode is per conversation; the newest plan_mode event for this one wins.
  const planMode = useMemo(() => {
    for (const event of [...snapshot.events].reverse()) {
      if (event.type !== "plan_mode") continue;
      const data = event.data as { session?: unknown; enabled?: unknown } | null;
      if (data?.session !== activeSession) continue;
      return data.enabled === true;
    }
    return false;
  }, [snapshot.events, activeSession]);

  const setPlanMode = (enabled: boolean): void => {
    if (activeSession === null) return;
    void client.request("plan_mode", enabled ? { session: activeSession, enabled: true } : { session: activeSession, approve: true });
  };
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
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("menu");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [logText, setLogText] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  /** The chat being renamed, with its draft title; null when not editing. */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  /** Where the last export landed, shown until the next thing happens. */
  const [exportNote, setExportNote] = useState<string | null>(null);
  /** Text the Android share sheet parked for us, with a fresh stamp per share. */
  const [shared, setShared] = useState<{ text: string; at: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The share inbox is one slot: ask whenever the app becomes visible, and
  // the daemon hands the text over exactly once.
  useEffect(() => {
    const pull = (): void => {
      void client
        .request<{ ok?: boolean; text?: string }>("take_shared", {})
        .then((answer) => {
          if (typeof answer.text === "string" && answer.text.trim().length > 0) {
            setShared({ text: answer.text, at: Date.now() });
          }
        })
        .catch(() => {
          /* not shared from, or the daemon is not up yet */
        });
    };
    pull();
    document.addEventListener("visibilitychange", pull);
    return () => document.removeEventListener("visibilitychange", pull);
  }, [client]);

  // Ctrl-K opens the drawer on the search field, like every reference app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenuOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Search also finds what was said, not just what a chat is called. */
  const sessionText = useMemo(() => {
    const blob = new Map<string, string>();
    const firstSession = snapshot.sessions[0]?.id ?? "";
    for (const event of snapshot.events) {
      const data = event.data as { session?: unknown; text?: unknown } | null;
      if (data === null || typeof data.text !== "string") continue;
      const owner = typeof data.session === "string" ? data.session : firstSession;
      if (owner.length === 0) continue;
      blob.set(owner, (blob.get(owner) ?? "") + " " + data.text.toLowerCase());
    }
    return blob;
  }, [snapshot.events, snapshot.sessions]);
  // The dock's clock while a turn is open: the stuck report is a claim about
  // time, and time does not re-render on its own.
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (turn === null) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [turn?.startId, turn === null]);

  // The daemon's own output, served by the app shell on loopback. This is the
  // only way to see why it refused to start when the socket never opens.
  async function loadLog(): Promise<void> {
    try {
      const response = await fetch("http://127.0.0.1:7413/log");
      const text = await response.text();
      setLogText(text.trim().length === 0 ? "the daemon wrote nothing yet" : text.slice(-8000));
    } catch (error) {
      setLogText(`cannot read the log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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

  function send(text: string, image?: { mime: string; data: string }): void {
    try {
      client.sendMessage(text, activeSession, image);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The message could not be sent.");
    }
  }

  function regenerate(seq: number): void {
    void client
      .regenerate(seq)
      .then(() => setNotice(null))
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "could not regenerate");
      });
  }

  // How long the running turn has been silent. Reported, not judged: a
  // reasoning model may think for minutes, so the number is shown and the
  // Stop button stays the only verdict.
  const quiet = turnQuietMs(snapshot.events, turn, nowTick === 0 ? Date.now() : nowTick);
  const quietMinutes = Math.floor(quiet / 60_000);

  function openSettings(page: SettingsPage = "menu"): void {
    setView("settings");
    setSettingsPage(page);
    setMenuOpen(false);
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
          <span className="titlebar__wait" data-tauri-drag-region>
            {snapshot.status === "open" ? "" : "waiting for the daemon…"}
          </span>
        </header>

        <main className="onboarding">
          <h1 className="onboarding__title">Start on this device</h1>
          <p className="onboarding__slogan">One agent, everywhere</p>
          <p className="onboarding__text">
            A chain is the conversation and everything around it. Create one here,
            or join one that already exists — joining takes the chain's history as
            your own.
          </p>

          <button
            type="button"
            className="onboarding__primary"
            disabled={false}
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
              placeholder="code from the other device"
              onChange={(event) => setJoinCode(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="onboarding__secondary"
              disabled={joinCode.trim().length === 0}
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
              ? "The daemon is running on this device."
              : "Waiting for the daemon to answer."}
          </p>

          <details className="onboarding__daemon">
            <summary className="onboarding__label">Daemon log</summary>
            <button type="button" className="onboarding__secondary" onClick={() => void loadLog()}>
              Load log
            </button>
            {logText !== null ? <pre className="onboarding__code onboarding__log">{logText}</pre> : null}
          </details>
        </main>
      </div>
    );
  }

  const inSettingsSubpage = view === "settings" && settingsPage !== "menu";
  const pageTitle =
    view === "chat"
      ? (snapshot.sessions.find((entry) => entry.id === activeSession)?.title ?? "New chat")
      : settingsPage === "menu"
        ? "Settings"
        : (SETTINGS_ROWS.find(([id]) => id === settingsPage)?.[1] ?? "Settings");

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        {inSettingsSubpage ? (
          <button
            type="button"
            className="titlebar__menu"
            aria-label="Back"
            onClick={() => setSettingsPage("menu")}
          >
            ‹
          </button>
        ) : (
          <button
            type="button"
            className="titlebar__menu"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>
        )}
        <span className="titlebar__title" data-tauri-drag-region>
          {pageTitle}
        </span>
        <button
          type="button"
          className="titlebar__model"
          onClick={() => setSheetOpen(true)}
          title={`${snapshot.provider ?? "no provider"} — tap to switch`}
        >
          {snapshot.model ?? "Select a model"}
        </button>
      </header>

      <main className={view === "chat" ? "conversation" : "conversation conversation--panel"} aria-label="Conversation">
        {view === "chat" ? (
          <Transcript
            events={visible}
            pending={snapshot.pending}
            node={snapshot.node}
            onRegenerate={regenerate}
            onCheckpoint={() => {
              const title = snapshot.sessions.find((entry) => entry.id === activeSession)?.title ?? "chat";
              client.checkpoint(title);
            }}
            onApprove={(req, allow) => {
              void client
                .request("tool_approve", { req, allow })
                .catch(() => {
                  /* the banner keeps its buttons; the next refresh tells the truth */
                });
            }}
            onEditMessage={(text) => setShared({ text, at: Date.now() })}
          />
        ) : settingsPage === "menu" ? (
          <section className="panel settings">
            {SETTINGS_ROWS.map(([id, label, hint]) => (
              <button key={id} type="button" className="settings__row" onClick={() => setSettingsPage(id)}>
                <span className="settings__cell">
                  <span className="settings__label">{label}</span>
                  <span className="settings__hint">{hint}</span>
                </span>
                <span className="settings__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </section>
        ) : settingsPage === "providers" ? (
          <ProvidersPanel
            client={client}
            current={snapshot.model ?? "no model"}
            onProviderAdded={() => {
              setView("chat");
              setSheetOpen(true);
            }}
          />
        ) : settingsPage === "agent" ? (
          <CapabilitiesPanel client={client} />
        ) : settingsPage === "tools" ? (
          <ToolsPanel client={client} />
        ) : settingsPage === "workspace" ? (
          <WorkspacePanel client={client} />
        ) : settingsPage === "schedules" ? (
          <>
            <SchedulesPanel client={client} />
            <GoalsPanel
              goals={foldGoals(snapshot.events)}
              onClose={(id) => void client.request("goal_update", { id, status: "done" })}
              onCreate={(text) => void client.request("goal", { text })}
            />
          </>
        ) : settingsPage === "checkpoints" ? (
          <CheckpointsPanel
            client={client}
            onRewind={(seq) => {
              client.rewind(seq);
              setView("chat");
            }}
          />
        ) : settingsPage === "devices" ? (
          <DevicesPage snapshot={snapshot} client={client} />
        ) : settingsPage === "storage" ? (
          <StorageWindowPage client={client} />
        ) : (
          <AboutPage snapshot={snapshot} client={client} logText={logText} onLoadLog={() => void loadLog()} />
        )}
      </main>

      {menuOpen ? (
        <button
          type="button"
          className="rail__scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className={menuOpen ? "rail rail--open" : "rail"}>
        <div className="rail__brand">
          <span className="rail__mark" aria-hidden="true" />
          <span className="rail__name">Roan</span>
        </div>

        <button
          type="button"
          className="rail__new"
          disabled={disabled}
          onClick={() => {
            client.newSession();
            setView("chat");
            setMenuOpen(false);
          }}
        >
          ＋ New chat
        </button>

        <input
          ref={searchRef}
          className="rail__search"
          placeholder="Search chats  ·  Ctrl-K"
          value={sessionQuery}
          onChange={(event) => setSessionQuery(event.target.value)}
        />

        {exportNote !== null ? <p className="rail__exportnote">{exportNote}</p> : null}
        <div className="rail__sessions">
          <ul className="rail__list">
            {snapshot.sessions
              .filter((session) => {
                const needle = sessionQuery.trim().toLowerCase();
                if (needle.length === 0) return true;
                if (session.title.toLowerCase().includes(needle)) return true;
                return (sessionText.get(session.id) ?? "").includes(needle);
              })
              .map((session) => (
                <li key={session.id}>
                  {renaming !== null && renaming.id === session.id ? (
                    <input
                      className="rail__rename"
                      autoFocus
                      aria-label="Rename chat"
                      // Typing replaces the old name instead of appending to it.
                      onFocus={(event) => event.target.select()}
                      value={renaming.draft}
                      onChange={(event) => setRenaming({ id: session.id, draft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          const title = renaming.draft.trim();
                          if (title.length > 0) client.renameSession(session.id, title);
                          setRenaming(null);
                        } else if (event.key === "Escape") {
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className={
                        session.id === activeSession ? "rail__row rail__row--active" : "rail__row"
                      }
                    >
                      <button
                        type="button"
                        className="rail__session"
                        onClick={() => {
                          client.selectSession(session.id);
                          setView("chat");
                          setMenuOpen(false);
                        }}
                        title={`${session.title} — ${String(session.messages)} messages`}
                      >
                        {session.title}
                      </button>
                      <button
                        type="button"
                        className="rail__edit"
                        aria-label={`Rename ${session.title}`}
                        title="Rename"
                        onClick={() => setRenaming({ id: session.id, draft: session.title })}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="rail__edit"
                        aria-label={`Export ${session.title}`}
                        title="Export as markdown"
                        onClick={() => {
                          void client
                            .request<{ ok?: boolean; path?: string; shared?: string | null; error?: string }>("export", { what: session.id })
                            .then((answer) => {
                              setExportNote(
                                answer.ok === true && answer.path !== undefined
                                  ? `Exported to ${answer.path}${answer.shared !== null && answer.shared !== undefined ? ` and ${answer.shared}` : ""}`
                                  : `Export failed: ${answer.error ?? "the daemon did not answer"}`,
                              );
                            })
                            .catch(() => setExportNote("Export failed: the daemon did not answer"));
                        }}
                      >
                        ⤓
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>

        <button
          type="button"
          className={view === "settings" ? "rail__footer rail__footer--active" : "rail__footer"}
          onClick={() => openSettings()}
        >
          ⚙ Settings
        </button>
      </aside>

      <footer className={view === "chat" ? "dock" : "dock dock--hidden"}>
        {turn !== null ? (
          <div className={quiet >= 300_000 ? "dock__state dock__state--stuck" : "dock__state"}>
            <span className="dock__dot" aria-hidden="true" />
            Roan is working · {phase}
            {quiet >= 120_000 ? (
              <span className="dock__quiet"> · no updates for {String(quietMinutes)}m</span>
            ) : null}
            {quiet >= 300_000 ? <span className="dock__quiet"> · looks stuck</span> : null}
            <button type="button" className="dock__stop" onClick={() => void client.cancelTurn()}>
              Stop
            </button>
          </div>
        ) : null}
        <Composer
          disabled={disabled}
          placeholder={placeholder}
          onSend={send}
          prefill={shared}
          onPickFile={() => setView("chat")}
          client={client}
          planMode={planMode}
          onPlanModeChange={setPlanMode}
          steerable={turn !== null && !disabled}
          onSteer={(text) => void client.steer(text)}
        />
      </footer>

      {sheetOpen ? (
        <ModelSheet
          client={client}
          provider={snapshot.provider ?? null}
          model={snapshot.model ?? null}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** The chain's members and the invite, out of the chat drawer. */
function DevicesPage({
  snapshot,
  client,
}: {
  snapshot: ChainSnapshot;
  client: ChainClient;
}): ReactElement {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [renamingNode, setRenamingNode] = useState<{ id: string; draft: string } | null>(null);
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Sync</h2>
      </header>
      <p className="panel__sub">Every device runs its own Roan; the chain keeps them equal.</p>
      <ul className="panel__list">
        <li className="panel__item">
          <span className="panel__path">Chain</span>
          <span className="panel__src">{snapshot.chain}</span>
        </li>
        <li className="panel__item">
          <span className="panel__path">Link</span>
          <span className="panel__src">
            {snapshot.peers.length > 0
              ? `live with ${String(snapshot.peers.length)} node${snapshot.peers.length === 1 ? "" : "s"}`
              : "this device only"}
          </span>
        </li>
        <li className="panel__item">
          <span className="panel__path">Daemon</span>
          <span className="panel__src">{snapshot.status === "open" ? "running" : "waiting"}</span>
        </li>
      </ul>

      <h3 className="panel__label">Nodes in this chain</h3>
      <ul className="panel__list">
        {snapshot.nodes.map((entry) => {
          // The daemon knows best (it reports self as live); peers are the fallback.
          const live = entry.live ?? (snapshot.peers.includes(entry.node) || snapshot.peers.includes(entry.name));
          const here = entry.node === snapshot.node;
          return (
            <li key={entry.node} className="sync__node">
              {renamingNode !== null && renamingNode.id === entry.node ? (
                <input
                  className="rail__rename"
                  autoFocus
                  aria-label="Rename node"
                  onFocus={(event) => event.target.select()}
                  value={renamingNode.draft}
                  onChange={(event) => setRenamingNode({ id: entry.node, draft: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const name = renamingNode.draft.trim();
                      if (name.length > 0) client.renameNode(entry.node, name);
                      setRenamingNode(null);
                    } else if (event.key === "Escape") {
                      setRenamingNode(null);
                    }
                  }}
                />
              ) : (
                <>
                  <span className={live ? "sync__dot sync__dot--live" : "sync__dot"} aria-hidden="true" />
                  <span className="sync__name">{entry.name}</span>
                  {here ? <span className="sync__here">this device</span> : null}
                  <span className="sync__addr">{entry.host.length > 0 ? `${entry.host}:${String(entry.port)}` : "address unknown"}</span>
                  <button
                    type="button"
                    className="rail__edit"
                    aria-label={`Rename ${entry.name}`}
                    title="Rename"
                    onClick={() => setRenamingNode({ id: entry.node, draft: entry.name })}
                  >
                    ✎
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="panel__hint">A rename rides the chain: every device shows the same roster.</p>
      <button
        type="button"
        className="panel__leave-open"
        onClick={() => {
          void client
            .request<{ ok?: boolean; path?: string; shared?: string | null; count?: number; error?: string }>("export", { what: "chain" })
            .then((answer) =>
              alert(
                answer.ok === true && answer.path !== undefined
                  ? `Exported ${String(answer.count ?? 0)} events to ${answer.path}`
                  : `Export failed: ${answer.error ?? "the daemon did not answer"}`,
              ),
            )
            .catch(() => alert("Export failed: the daemon did not answer"));
        }}
      >
        Export the whole chain (JSONL)
      </button>
      {snapshot.invite !== null ? <InviteBlock code={snapshot.invite} /> : null}
      <p className="panel__hint">
        The invite turns another device into a member of this chain: it takes the whole history as
        its own.
      </p>
      {confirmLeave ? (
        <div className="panel__leave">
          <p className="panel__leave-text">
            Leave this chain? The history stays on this machine under a timestamped archive —
            nothing is deleted — and Roan comes back as an empty start: create a new chain or join
            one with a code.
          </p>
          <div className="panel__leave-row">
            <button type="button" className="panel__leave-cancel" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
            <button
              type="button"
              className="panel__leave-go"
              onClick={() => client.leaveChain()}
            >
              Leave
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="panel__leave-open" onClick={() => setConfirmLeave(true)}>
          Leave this chain
        </button>
      )}
    </section>
  );
}

/** The Android storage window: the shared storages as siblings of the home. */
function StorageWindowPage({ client }: { client: ChainClient }): ReactElement {
  const [result, setResult] = useState<{ ok?: boolean; created?: string[]; existed?: string[]; refused?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Storage window</h2>
      </header>
      <p className="panel__sub">
        The agent's home stays app-private; the shared storages appear next to it as windows —
        nothing is copied or moved. Android only, and it needs All files access.
      </p>
      <button
        type="button"
        className="panel__leave-open"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void client
            .request<{ ok?: boolean; created?: string[]; existed?: string[]; refused?: string | null }>("storage_window", {})
            .then((answer) => setResult(answer))
            .catch(() => setResult({ ok: false, refused: "the daemon did not answer" }))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Opening…" : "Open the storage window"}
      </button>
      {result !== null ? (
        <p className="panel__hint">
          {result.refused !== null && result.refused !== undefined
            ? result.refused
            : `Windows open: ${[...(result.created ?? []), ...(result.existed ?? [])].join(", ")}`}
        </p>
      ) : null}
    </section>
  );
}

/** The facts about this instance, out of the conversation's way. */
function AboutPage({
  snapshot,
  client,
  logText,
  onLoadLog,
}: {
  snapshot: ChainSnapshot;
  client: ChainClient;
  logText: string | null;
  onLoadLog: () => void;
}): ReactElement {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">About</h2>
        <p className="panel__slogan">One agent, everywhere</p>
      </header>
      <ul className="panel__list">
        <li className="panel__item">
          <span className="panel__path">Version</span>
          <span className="panel__src">{pkg.version}</span>
        </li>
        <li className="panel__item">
          <span className="panel__path">Node</span>
          <span className="panel__src">{snapshot.node}</span>
        </li>
        <li className="panel__item">
          <span className="panel__path">Chain</span>
          <span className="panel__src">{snapshot.chain}</span>
        </li>
        <li className="panel__item">
          <span className="panel__path">Daemon</span>
          <span className="panel__src">{snapshot.status === "open" ? "running" : "waiting"}</span>
        </li>
      </ul>
      <UpdateCard daemon={client} />
      <details className="onboarding__daemon">
        <summary className="panel__label">Daemon log</summary>
        <button type="button" className="panel__secondary panel__secondary--inline" onClick={onLoadLog}>
          Load log
        </button>
        {logText !== null ? <pre className="onboarding__code onboarding__log">{logText}</pre> : null}
      </details>
    </section>
  );
}

/** The invite is a long string that is only interesting once, so it stays shut. */
function InviteBlock({ code }: { code: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rail__invite">
      <button type="button" className="panel__secondary" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide the invite" : "Invite a device"}
      </button>
      {open ? (
        <>
          <code className="onboarding__code">{code}</code>
          <button
            type="button"
            className="rail__invitecopy"
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      ) : null}
    </div>
  );
}
