import type { Event } from "../protocol/types.js";

/**
 * Who is in this chain, and where they are.
 *
 * A node announces itself as an event: its id, a human name, the address a peer
 * can dial and the peer port. Every device folds the same events, so the list is
 * identical everywhere and needs no server to hold it. The address is only a
 * hint — reachability is decided by probing it, never assumed.
 *
 * Membership is a fold too: a `node_remove` event hides a node, and the next
 * `node` announcement from that node brings it back. A tombstone therefore only
 * means "nobody has heard from this device since", never "this device is gone
 * for good" — a live device that reconnects is not a ghost.
 */
export interface NodeInfo {
  readonly node: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly updatedAt: number;
}

interface NodeData {
  node?: unknown;
  name?: unknown;
  host?: unknown;
  port?: unknown;
}

/** The membership fold: who is visible, and which ids a tombstone still hides. */
export interface NodeRoster {
  /** Announcements still in force, oldest first, without the removed ones. */
  readonly visible: readonly NodeInfo[];
  /**
   * Ids whose newest statement is a removal. Lets a device notice that it has
   * been taken out of the chain and announce itself again.
   */
  readonly removed: ReadonlySet<string>;
}

function readOne(event: Event, data: NodeData): NodeInfo | null {
  const node = typeof data.node === "string" && data.node.length > 0 ? data.node : event.node;
  if (typeof node !== "string" || node.length === 0) return null;
  const name = typeof data.name === "string" && data.name.length > 0 ? data.name : node;
  const host = typeof data.host === "string" ? data.host : "";
  const port = typeof data.port === "number" && Number.isInteger(data.port) ? data.port : 0;
  return { node, name, host, port, updatedAt: event.ts };
}

function asNodeData(value: unknown): NodeData | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as NodeData)
    : null;
}

/**
 * Folds the chain into a roster: the newest announcement per node, minus the
 * nodes a later `node_remove` took out.
 *
 * Order is what decides: a removal after an announcement hides the node, and an
 * announcement after a removal shows it again. Removing a node that is already
 * removed changes nothing, so the fold is idempotent.
 */
export function foldNodeRoster(events: readonly Event[]): NodeRoster {
  const byNode = new Map<string, NodeInfo>();
  const removed = new Set<string>();

  for (const event of events) {
    const data = asNodeData(event.data);
    if (data === null) continue;

    if (event.type === "node_remove") {
      const target = typeof data.node === "string" && data.node.length > 0 ? data.node : null;
      if (target !== null) removed.add(target);
      continue;
    }
    if (event.type !== "node") continue;

    const info = readOne(event, data);
    if (info === null) continue;
    // A node that moved keeps one entry: its latest address wins, because an
    // old address is worse than none.
    byNode.set(info.node, info);
    // It is here, whatever an earlier tombstone said.
    removed.delete(info.node);
  }

  const visible = [...byNode.values()].filter((info) => !removed.has(info.node));
  return { visible, removed };
}

/**
 * The devices this chain shows, oldest first, with the removed ones left out.
 * This is what the daemon puts in `state` and what a tool may address.
 */
export function nodesFromEvents(events: readonly Event[]): NodeInfo[] {
  return [...foldNodeRoster(events).visible];
}

/**
 * The newest announcement per node, oldest first, minus removed nodes.
 * Kept as the short name every existing caller uses; `nodesFromEvents` is the
 * same fold under the name membership talks about.
 */
export function readNodes(events: readonly Event[]): NodeInfo[] {
  return nodesFromEvents(events);
}

/**
 * Finds a node by what a person would say: its name ("Roans-Server"), its
 * address, or its id. Case-insensitive, and a unique prefix of a name counts.
 * Returns null when nothing matches or when a prefix is ambiguous.
 */
export function findNode(nodes: readonly NodeInfo[], wanted: string): NodeInfo | null {
  const needle = wanted.trim().toLowerCase();
  if (needle.length === 0) return null;
  const exact = nodes.filter(
    (info) =>
      info.name.toLowerCase() === needle ||
      info.node.toLowerCase() === needle ||
      info.host.toLowerCase() === needle,
  );
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const prefixed = nodes.filter(
    (info) => info.name.toLowerCase().startsWith(needle) || info.node.toLowerCase().startsWith(needle),
  );
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}

/** What the agent is told about the chain's machines, one line each. */
export function describeNodes(nodes: readonly NodeInfo[]): string {
  if (nodes.length === 0) return "no other machine in this chain has announced itself yet";
  return nodes
    .map((info) => `${info.name} (${info.node}${info.host.length > 0 ? ` at ${info.host}:${String(info.port)}` : ", address unknown"})`)
    .join("; ");
}
