import { useEffect, useState } from "react";
import type { ReactElement } from "react";

export interface PeerRow {
  node: string;
  tailnetName: string | null;
  headSeq: number;
  live: boolean;
  lastSeenMs?: number;
}

export interface PeerListProps {
  peers: readonly PeerRow[];
  self: string;
}

function since(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function state(row: PeerRow, now: number): string {
  if (row.live) return "Live";
  if (row.lastSeenMs === undefined) return "Offline · last seen unknown";
  return `Offline · last seen ${since(row.lastSeenMs, now)}`;
}

export function PeerList({ peers, self }: PeerListProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  const offline = peers.some((row) => !row.live);

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [offline]);

  return (
    <section className="peers" aria-label="Connected nodes">
      <h2 className="peers__heading">
        Nodes
        <span className="peers__count">
          {peers.length} {peers.length === 1 ? "node" : "nodes"}
        </span>
      </h2>

      {peers.length === 0 ? (
        <p className="peers__empty">No nodes in this chain yet.</p>
      ) : (
        <ul className="peers__list">
          {peers.map((row) => {
            const isSelf = row.node === self;
            return (
              <li
                key={row.node}
                className={`peers__row peers__row--${row.live ? "live" : "offline"}`}
                aria-current={isSelf ? "true" : undefined}
              >
                <div className="peers__ident">
                  <span className="peers__name">{row.tailnetName ?? row.node}</span>
                  {row.tailnetName ? (
                    <span className="peers__node">{row.node}</span>
                  ) : null}
                  {isSelf ? <span className="peers__badge">this device</span> : null}
                </div>
                <div className="peers__meta">
                  <span className="peers__state">{state(row, now)}</span>
                  <span className="peers__seq" title="Head sequence number">
                    #{row.headSeq}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
