import type { Event } from "../protocol/types.js";

/**
 * Who is in this chain, and where they are.
 *
 * A node announces itself as an event: its id, a human name, the address a peer
 * can dial and the peer port. Every device folds the same events, so the list is
 * identical everywhere and needs no server to hold it. The address is only a
 * hint — reachability is decided by probing it, never assumed.
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

function readOne(event: Event, data: NodeData): NodeInfo | null {
  const node = typeof data.node === "string" && data.node.length > 0 ? data.node : event.node;
  if (typeof node !== "string" || node.length === 0) return null;
  const name = typeof data.name === "string" && data.name.length > 0 ? data.name : node;
  const host = typeof data.host === "string" ? data.host : "";
  const port = typeof data.port === "number" && Number.isInteger(data.port) ? data.port : 0;
  return { node, name, host, port, updatedAt: event.ts };
}

/**
 * The newest announcement per node, oldest first. A node that moved keeps one
 * entry: its latest address wins, because an old address is worse than none.
 */
export function readNodes(events: readonly Event[]): NodeInfo[] {
  const byNode = new Map<string, NodeInfo>();
  for (const event of events) {
    if (event.type !== "node") continue;
    const data = event.data as NodeData | null;
    if (data === null || typeof data !== "object") continue;
    const info = readOne(event, data);
    if (info !== null) byNode.set(info.node, info);
  }
  return [...byNode.values()];
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
