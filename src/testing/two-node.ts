/**
 * In-process two-node harness over temp directories.
 *
 * Two real on-disk stores (`EventStore`, one SQLite file per node) are wrapped
 * in the `NodeStore` interface that replication speaks, linked by a synchronous
 * in-memory duplex transport, and driven by the real `replicate()` sessions.
 *
 * Why an append gate: `ReplicationSession` treats a shared seq with a different
 * id as a hard conflict and never picks a winner. That is the right behaviour for
 * a chain with one writer, but it also means two genuinely concurrent local
 * appends to two *empty* stores both claim seq 1 and can never converge. The
 * harness therefore follows the same rule the daemon does: a node catches up
 * before it writes. `TestNode.append` waits for its turn on a per-pair gate,
 * replicates from the peer, and only then appends at its own `head() + 1`. Writes
 * are still "concurrent" from the caller's point of view (`Promise.all`), but the
 * order in which they touch the chain is serial, which is exactly what makes the
 * seqs contiguous and the lists converge.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, type EventType } from "../chain/store.js";
import { replicate } from "../sync/replicate.js";
import type {
  AppendOutcome,
  Event,
  Frame,
  Logger,
  NodeStore,
  PeerTransport,
} from "../sync/types.js";

/** Default chain every harness node keeps. */
export const TEST_CHAIN = "gesprek";

/** `EventStore.read` refuses a larger page; a harness never needs more. */
const MAX_EVENTS = 10_000;

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const EVENT_TYPES: readonly string[] = [
  "message",
  "assistant",
  "tool_call",
  "tool_result",
  "error",
  "turn_start",
  "turn_end",
  "env",
];

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.includes(value);
}

/** One node's chain, backed by a SQLite file and shaped like `NodeStore`. */
export interface TestNodeStore extends NodeStore {
  /** Directory the node was given; removed by `withTwoNodes`. */
  readonly dir: string;
  /** Path of the SQLite file behind this node. */
  readonly path: string;
  /** The raw on-disk store, so a test can seed or inspect without the adapter. */
  readonly disk: EventStore;
  /** Every event in seq order. Throws if the chain is longer than `MAX_EVENTS`. */
  all(): Event[];
  /** Closes the SQLite handle; `withTwoNodes` does this for you. */
  close(): void;
}

export interface TestNode {
  /** Name used in error messages, "a" or "b". */
  readonly name: string;
  /** Directory holding this node's store; under `os.tmpdir()`. */
  readonly dir: string;
  /** The `NodeStore` replication writes into. */
  readonly store: TestNodeStore;
  /** Highest seq this node has. */
  head(): number;
  /**
   * Catches up from the peer, then appends one event at `head() + 1`.
   *
   * `Promise.all([a.append(...), b.append(...)])` is safe: the shared gate makes
   * one append finish (including its catch-up) before the other starts.
   */
  append(type: EventType, data?: unknown): Promise<Event>;
}

type WriteGate = <T>(work: () => Promise<T>) => Promise<T>;

function createWriteGate(): WriteGate {
  let tail: Promise<void> = Promise.resolve();
  return function run<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    // A failed write must not poison the queue for the next one.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/** Synchronous two-ended transport: what one end sends the other end receives. */
class LinkEnd implements PeerTransport {
  readonly label: string;
  private messageHandler: ((raw: string) => void) | undefined;
  private closeHandler: ((reason?: string) => void) | undefined;
  private closed = false;
  private peer: LinkEnd | undefined;

  constructor(label: string) {
    this.label = label;
  }

  static pair(leftLabel: string, rightLabel: string): [LinkEnd, LinkEnd] {
    const left = new LinkEnd(leftLabel);
    const right = new LinkEnd(rightLabel);
    left.peer = right;
    right.peer = left;
    return [left, right];
  }

  send(frame: Frame): void {
    if (this.closed) return;
    this.peer?.receive(JSON.stringify(frame));
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.peer?.receiveClose(reason);
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  private receive(raw: string): void {
    if (this.closed) return;
    this.messageHandler?.(raw);
  }

  private receiveClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.(reason);
  }
}

function openStore(dir: string, chain: string, nodeId: string): TestNodeStore {
  const path = join(dir, "events.sqlite");
  const disk = EventStore.open(path);
  const listeners = new Set<(event: Event) => void>();

  const store: TestNodeStore = {
    chain,
    nodeId,
    dir,
    path,
    disk,
    head: (): number => disk.head(chain),
    idAt: (seq: number): string | undefined => {
      if (!Number.isInteger(seq) || seq < 1) return undefined;
      return disk.read(chain, seq, 1)[0]?.id;
    },
    has: (id: string): boolean => store.all().some((event) => event.id === id),
    since: (from: number): Event[] => {
      const start = Number.isInteger(from) && from > 1 ? from : 1;
      return disk.read(chain, start, MAX_EVENTS);
    },
    append: (event: Event): AppendOutcome => {
      if (event.chain !== chain) {
        throw new Error(
          `node ${nodeId}: cannot append event ${event.id} from chain "${event.chain}" into chain "${chain}"`,
        );
      }
      if (!isEventType(event.type)) {
        throw new Error(`node ${nodeId}: cannot append event ${event.id} with unknown type "${event.type}"`);
      }
      if (!Number.isInteger(event.seq) || event.seq < 1) {
        throw new Error(`node ${nodeId}: cannot append event ${event.id} at invalid seq ${event.seq}`);
      }
      if (store.has(event.id)) return { status: "duplicate" };

      const head = disk.head(chain);
      if (event.seq <= head) {
        const existingId = store.idAt(event.seq);
        if (existingId === undefined) {
          throw new Error(
            `node ${nodeId}: store reports head ${head} but has nothing at seq ${event.seq}`,
          );
        }
        return { status: "conflict", existingId };
      }
      if (event.seq !== head + 1) {
        throw new Error(
          `node ${nodeId}: cannot append seq ${event.seq} after head ${head}; a chain only grows at head + 1`,
        );
      }

      const stored = disk.append(chain, {
        v: 1,
        id: event.id,
        node: event.node,
        ts: event.ts,
        type: event.type,
        data: event.data,
      });
      const appended: Event = stored;
      for (const listener of listeners) listener(appended);
      return { status: "appended" };
    },
    subscribe: (listener: (event: Event) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    all: (): Event[] => disk.read(chain, 1, MAX_EVENTS),
    close: (): void => {
      listeners.clear();
      disk.close();
    },
  };

  return store;
}

class Node implements TestNode {
  peer: Node | undefined;
  private counter = 0;

  constructor(
    readonly name: string,
    readonly store: TestNodeStore,
    private readonly gate: WriteGate,
  ) {}

  get dir(): string {
    return this.store.dir;
  }

  head(): number {
    return this.store.head();
  }

  async append(type: EventType, data?: unknown): Promise<Event> {
    const peer = this.peer;
    return this.gate(async () => {
      // One-writer rule: see the note at the top of this file.
      if (peer !== undefined) await syncBothWays(this, peer);

      const seq = this.store.head() + 1;
      this.counter += 1;
      const event: Event = {
        v: 1,
        chain: this.store.chain,
        seq,
        id: `${this.store.nodeId}-${this.counter}`,
        node: this.store.nodeId,
        ts: Date.now(),
        type,
        data: data ?? null,
      };
      const outcome = this.store.append(event);
      if (outcome.status !== "appended") {
        throw new Error(
          `node ${this.name}: append of event ${event.id} at seq ${event.seq} was refused with "${outcome.status}"`,
        );
      }
      return event;
    });
  }
}

/**
 * Runs `fn` against two nodes whose stores live in sibling directories under
 * `os.tmpdir()`. Both directories are removed afterwards, also when `fn` throws,
 * and the SQLite handles are closed first.
 */
export async function withTwoNodes(
  fn: (a: TestNode, b: TestNode) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "roan-two-node-"));
  const dirA = join(root, "a");
  const dirB = join(root, "b");
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });

  const gate = createWriteGate();
  const a = new Node("a", openStore(dirA, TEST_CHAIN, "a"), gate);
  const b = new Node("b", openStore(dirB, TEST_CHAIN, "b"), gate);
  a.peer = b;
  b.peer = a;

  try {
    await fn(a, b);
  } finally {
    a.store.close();
    b.store.close();
    await rm(root, { recursive: true, force: true });
  }
}

/** One bidirectional pass: replicate a→b and b→a over the same in-process link. */
function syncOnce(a: TestNode, b: TestNode): void {
  if (a.store.chain !== b.store.chain) {
    throw new Error(
      `sync ${a.name} <-> ${b.name}: chains differ ("${a.store.chain}" vs "${b.store.chain}")`,
    );
  }

  const problems: string[] = [];
  const [left, right] = LinkEnd.pair(`${a.name}->${b.name}`, `${b.name}->${a.name}`);

  const onConflict = (report: { seq: number; localId: string; remoteId: string }): void => {
    problems.push(
      `hard conflict on seq ${report.seq}: ${a.name}/${b.name} hold "${report.localId}" vs "${report.remoteId}"`,
    );
  };
  const onError = (error: Error): void => {
    problems.push(`protocol error: ${error.message}`);
  };

  const sessionA = replicate({
    store: a.store,
    transport: left,
    logger: silentLogger,
    onConflict,
    onError,
  });
  const sessionB = replicate({
    store: b.store,
    transport: right,
    logger: silentLogger,
    onConflict,
    onError,
  });

  sessionA.close("sync done");
  sessionB.close("sync done");

  const first = problems[0];
  if (first !== undefined) {
    throw new Error(`sync ${a.name} <-> ${b.name} failed: ${first}`);
  }
  if (sessionA.status === "failed" || sessionB.status === "failed") {
    throw new Error(
      `sync ${a.name} <-> ${b.name} failed: session status is "${sessionA.status}"/"${sessionB.status}"`,
    );
  }
  if (sessionA.status === "conflicted" || sessionB.status === "conflicted") {
    throw new Error(`sync ${a.name} <-> ${b.name} failed: the chain diverged`);
  }
}

/** Replicates a→b and b→a. Throws when the two chains conflict or a frame fails. */
export async function syncBothWays(a: TestNode, b: TestNode): Promise<void> {
  syncOnce(a, b);
}

function describe(event: Event): string {
  return `seq ${event.seq} id "${event.id}" (node ${event.node}, type ${event.type})`;
}

function sameEvent(left: Event, right: Event): boolean {
  return (
    left.seq === right.seq &&
    left.id === right.id &&
    left.node === right.node &&
    left.type === right.type &&
    left.ts === right.ts &&
    JSON.stringify(left.data) === JSON.stringify(right.data)
  );
}

/**
 * Throws a message naming the offending node, seq and id when the two nodes do
 * not hold the same chain: different heads, a gap, or a different event at some
 * seq.
 */
export function assertConverged(a: TestNode, b: TestNode): void {
  const headA = a.head();
  const headB = b.head();
  if (headA !== headB) {
    throw new Error(
      `nodes did not converge: ${a.name} has head ${headA}, ${b.name} has head ${headB}`,
    );
  }

  const eventsA = a.store.all();
  const eventsB = b.store.all();
  for (const [name, events] of [
    [a.name, eventsA],
    [b.name, eventsB],
  ] as const) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event === undefined) {
        throw new Error(`node ${name}: missing event at index ${index} of its own chain`);
      }
      if (event.seq !== index + 1) {
        throw new Error(
          `node ${name}: chain is not contiguous at index ${index}: expected seq ${index + 1}, found ${event.seq}`,
        );
      }
    }
  }

  for (let index = 0; index < eventsA.length; index += 1) {
    const left = eventsA[index];
    const right = eventsB[index];
    if (left === undefined || right === undefined) {
      throw new Error(
        `nodes did not converge: chain length differs at index ${index} (${a.name} ${eventsA.length}, ${b.name} ${eventsB.length})`,
      );
    }
    if (!sameEvent(left, right)) {
      throw new Error(
        `nodes did not converge at index ${index}: ${a.name} has ${describe(left)}, ${b.name} has ${describe(right)}`,
      );
    }
  }
}
