import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ConnectionStatus, OpenTurn } from "../chain";

interface TurnStatusProps {
  turn: OpenTurn | null;
  status: ConnectionStatus;
  chain: string | null;
  node: string;
  peer: string | null;
  pending: number;
  lastSeq: number;
  error: string | null;
  /** A send that failed locally, e.g. the socket closed between click and write. */
  notice: string | null;
}

type Tone = "working" | "ready" | "waiting" | "offline";

function since(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function shortChain(chain: string | null): string {
  if (!chain) return "—";
  return chain.length > 14 ? `${chain.slice(0, 14)}…` : chain;
}

function describe(
  turn: OpenTurn | null,
  status: ConnectionStatus,
  node: string,
): { tone: Tone; headline: string; detail: string } {
  if (turn) {
    return {
      tone: "working",
      headline: `${turn.owner} is working`,
      detail:
        turn.owner === node
          ? "This turn runs on this device. The composer unlocks when it ends."
          : `The turn runs on ${turn.owner}. One turn at a time across the chain.`,
    };
  }
  if (status === "open") {
    return {
      tone: "ready",
      headline: "Ready",
      detail: `Messages you send run on ${node}.`,
    };
  }
  if (status === "reconnecting") {
    return {
      tone: "waiting",
      headline: "Reconnecting",
      detail: "Waiting for the local daemon to come back.",
    };
  }
  if (status === "closed") {
    return {
      tone: "offline",
      headline: "Daemon unreachable",
      detail: "Nothing can be sent until the connection is back.",
    };
  }
  return {
    tone: "waiting",
    headline: "Connecting",
    detail: "Looking for the daemon on this device.",
  };
}

export function TurnStatus({
  turn,
  status,
  chain,
  node,
  peer,
  pending,
  lastSeq,
  error,
  notice,
}: TurnStatusProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!turn) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [turn]);

  const view = describe(turn, status, node);

  return (
    <section className="status" aria-label="Turn and connection">
      <p
        className={`status__headline status__headline--${view.tone}`}
        id="turn-status"
        role="status"
        aria-live="polite"
      >
        <span className="status__dot" aria-hidden="true" />
        <span>{view.headline}</span>
      </p>
      <p className="status__detail">{view.detail}</p>

      <dl className="status__facts">
        <div>
          <dt>Chain</dt>
          <dd title={chain ?? undefined}>{shortChain(chain)}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>{node}</dd>
        </div>
        <div>
          <dt>Daemon</dt>
          <dd>{peer ?? "—"}</dd>
        </div>
        {turn ? (
          <div>
            <dt>Owner</dt>
            <dd>
              {turn.owner} · {since(turn.since, now)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Events</dt>
          <dd>{lastSeq > 0 ? lastSeq : "—"}</dd>
        </div>
        {pending > 0 ? (
          <div>
            <dt>Sending</dt>
            <dd>
              {pending} {pending === 1 ? "message" : "messages"}
            </dd>
          </div>
        ) : null}
      </dl>

      {notice ? (
        <p className="status__alert" role="alert">
          {notice}
        </p>
      ) : null}
      {error ? <p className="status__note">{error}</p> : null}
    </section>
  );
}
