import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ChainClient, openTurn } from "./chain";
import { Composer } from "./components/Composer";
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
const SOCKET_URL = host?.socket ?? "ws://127.0.0.1:7411/ws";

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

function shortChain(chain: string | null): string {
  if (!chain) return "no chain";
  return chain.length > 16 ? `${chain.slice(0, 16)}…` : chain;
}

export default function App(): ReactElement {
  const client = useMemo(() => new ChainClient({ url: SOCKET_URL, node: NODE }), []);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const turn = useMemo(() => openTurn(snapshot.events), [snapshot.events]);

  const [notice, setNotice] = useState<string | null>(null);

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
      client.sendMessage(text);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The message could not be sent.");
    }
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
        <span
          className="titlebar__chain"
          title={snapshot.chain ?? undefined}
          data-tauri-drag-region
        >
          {shortChain(snapshot.chain)}
        </span>
      </header>

      <main className="conversation" aria-label="Conversation">
        <Transcript
          events={snapshot.events}
          pending={snapshot.pending}
          node={snapshot.node}
        />
      </main>

      <aside className="rail">
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

      <footer className="dock">
        <Composer disabled={disabled} placeholder={placeholder} onSend={send} />
      </footer>
    </div>
  );
}
