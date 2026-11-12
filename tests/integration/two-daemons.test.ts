/**
 * Two real daemons, two temp homes, two ports.
 *
 * Node A creates a chain and has one event in it. Node B is started empty and
 * joins A with the invite code from `create_chain`. The only thing asserted is
 * what a user can observe through the control socket: after replication both
 * daemons report the same chain head, and that head is the event A seeded.
 *
 * This drives the shipped daemon entry point as a child process, not an
 * in-process harness: the peer server, the control server and the SQLite file
 * are all the real ones.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EventStore } from "../../src/chain/store.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CHAIN_EVENT_TYPE = "message" as const;

/** Every wait in this file has a deadline; no test hangs forever. */
const START_TIMEOUT_MS = 20_000;
const REPLY_TIMEOUT_MS = 10_000;
const REPLICATION_TIMEOUT_MS = 20_000;

type ControlFrame = Record<string, unknown>;

function isRecord(value: unknown): value is ControlFrame {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameType(frame: ControlFrame): string {
  return typeof frame["t"] === "string" ? frame["t"] : "";
}

/** Ask the OS for a port that is free right now, then close the probe socket. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) {
        probe.close();
        reject(new Error("could not read the port the OS assigned"));
        return;
      }
      const { port } = address;
      probe.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

interface Daemon {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly home: string;
  readonly controlPort: number;
  readonly peerPort: number;
  /** Everything the daemon wrote to stderr, for failure messages. */
  stderr(): string;
  /** Resolves on a stderr line matching `pattern`; rejects on timeout or exit. */
  waitForStderr(pattern: RegExp, timeoutMs: number): Promise<RegExpMatchArray>;
  stop(): Promise<void>;
}

function startDaemon(home: string, controlPort: number, peerPort: number): Daemon {
  const child = spawn(process.execPath, [TSX_CLI, "src/daemon/main.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ROAN_HOME: home,
      ROAN_CONTROL_PORT: String(controlPort),
      ROAN_PEER_PORT: String(peerPort),
      ROAN_PEER_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  const waiters: {
    pattern: RegExp;
    resolve: (match: RegExpMatchArray) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  const settle = (line: string): void => {
    for (const waiter of [...waiters]) {
      const match = line.match(waiter.pattern);
      if (match === null) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(match);
    }
  };

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    for (const line of stderr.split("\n")) settle(line);
  });

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(
            `daemon in ${home} exited before matching ${waiter.pattern}; stderr:\n${stderr}`,
          ),
        );
      }
      resolve();
    });
  });

  return {
    child,
    home,
    controlPort,
    peerPort,
    stderr: () => stderr,
    waitForStderr(pattern, timeoutMs) {
      return new Promise((resolve, reject) => {
        const already = stderr.match(pattern);
        if (already !== null) {
          resolve(already);
          return;
        }
        if (child.exitCode !== null) {
          reject(new Error(`daemon in ${home} already exited; stderr:\n${stderr}`));
          return;
        }
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(
            new Error(
              `daemon in ${home} did not print ${pattern} within ${timeoutMs}ms; stderr:\n${stderr}`,
            ),
          );
        }, timeoutMs);
        waiters.push({ pattern, resolve, reject, timer });
      });
    },
    async stop() {
      if (child.exitCode !== null) {
        await exited;
        return;
      }
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      await exited;
      clearTimeout(killTimer);
    },
  };
}

/** Minimal client for the local control socket. One waiter at a time. */
class ControlClient {
  private readonly socket: WebSocket;
  private readonly queue: ControlFrame[] = [];
  private waiter:
    | {
        predicate: (frame: ControlFrame) => boolean;
        resolve: (frame: ControlFrame) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      this.deliver(parsed);
    });
  }

  static connect(port: number): Promise<ControlClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`control socket on port ${port} did not open within ${REPLY_TIMEOUT_MS}ms`));
      }, REPLY_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new ControlClient(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`could not connect to the control socket on port ${port}`));
      });
    });
  }

  send(frame: ControlFrame): void {
    this.socket.send(JSON.stringify(frame));
  }

  /** Resolves with the first frame (past or future) that matches `predicate`. */
  next(
    predicate: (frame: ControlFrame) => boolean,
    label: string,
    timeoutMs = REPLY_TIMEOUT_MS,
  ): Promise<ControlFrame> {
    if (this.waiter !== undefined) {
      return Promise.reject(new Error(`control client already waiting for ${label}`));
    }
    const queuedIndex = this.queue.findIndex(predicate);
    if (queuedIndex >= 0) {
      const [frame] = this.queue.splice(queuedIndex, 1);
      if (frame !== undefined) return Promise.resolve(frame);
    }
    return new Promise<ControlFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      this.waiter = { predicate, resolve, reject, timer };
    });
  }

  private deliver(frame: ControlFrame): void {
    const waiter = this.waiter;
    if (waiter === undefined) {
      this.queue.push(frame);
      return;
    }
    if (!waiter.predicate(frame)) {
      this.queue.push(frame);
      return;
    }
    clearTimeout(waiter.timer);
    this.waiter = undefined;
    waiter.resolve(frame);
  }

  close(): void {
    if (this.waiter !== undefined) {
      clearTimeout(this.waiter.timer);
      this.waiter.reject(new Error("control client closed while waiting"));
      this.waiter = undefined;
    }
    this.socket.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestState(client: ControlClient): Promise<ControlFrame> {
  const reply = client.next((frame) => frameType(frame) === "state", "a state reply");
  client.send({ t: "state" });
  return reply;
}

function stateNumber(frame: ControlFrame, field: string): number {
  const data = frame["data"];
  if (!isRecord(data)) throw new Error(`state reply has no data object: ${JSON.stringify(frame)}`);
  const value = data[field];
  if (typeof value !== "number") {
    throw new Error(`state reply has no numeric ${field}: ${JSON.stringify(frame)}`);
  }
  return value;
}

function stateString(frame: ControlFrame, field: string): string {
  const data = frame["data"];
  if (!isRecord(data)) throw new Error(`state reply has no data object: ${JSON.stringify(frame)}`);
  const value = data[field];
  if (typeof value !== "string") {
    throw new Error(`state reply has no string ${field}: ${JSON.stringify(frame)}`);
  }
  return value;
}

/** Wait until `check` returns a value other than null, or fail with `label`. */
async function waitFor<T>(
  check: () => Promise<T | null>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== null) return value;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}${last === null ? "" : `; last error: ${String(last)}`}`);
}

test(
  "two daemons: create, join, and converge on the same head",
  { timeout: 90_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "roan-two-daemons-"));
    const homeA = join(root, "node-a");
    const homeB = join(root, "node-b");

    const daemons: Daemon[] = [];
    const clients: ControlClient[] = [];

    t.after(async () => {
      for (const client of clients) client.close();
      for (const daemon of daemons) await daemon.stop();
      await rm(root, { recursive: true, force: true });
    });

    const controlA = await freePort();
    const peerA = await freePort();
    const controlB = await freePort();
    const peerB = await freePort();

    const a = startDaemon(homeA, controlA, peerA);
    daemons.push(a);
    await a.waitForStderr(/waiting for a chain \(control port \d+\)/, START_TIMEOUT_MS);

    const clientA = await ControlClient.connect(controlA);
    clients.push(clientA);

    const createdReply = clientA.next(
      (frame) => frameType(frame) === "chain" || frameType(frame) === "control_error",
      "the create_chain reply",
    );
    clientA.send({ t: "create_chain" });
    const created = await createdReply;
    assert.equal(frameType(created), "chain", `create_chain failed: ${JSON.stringify(created)}`);

    const chainValue = created["chain"];
    const inviteValue = created["invite"];
    if (typeof chainValue !== "string" || chainValue.length === 0) {
      throw new Error(`create_chain returned no chain id: ${JSON.stringify(created)}`);
    }
    if (typeof inviteValue !== "string" || inviteValue.length === 0) {
      throw new Error(`create_chain returned no invite code: ${JSON.stringify(created)}`);
    }
    const chain = chainValue;
    const invite = inviteValue;

    // Seed one event directly into A's store. Doing it through `append` would
    // also start a model turn, and a failed turn would add an error event whose
    // timing makes the convergence assertion flaky. This is still the real
    // SQLite file the daemon reads, in WAL mode, from a second process.
    const storeA = EventStore.open(join(homeA, "workspace", "chain.db"));
    try {
      const seeded = storeA.append(chain, {
        id: "two-daemons-seed",
        node: "node-fixture",
        ts: Date.now(),
        type: CHAIN_EVENT_TYPE,
        data: { text: "hello from node a" },
      });
      assert.equal(seeded.seq, 1);
    } finally {
      storeA.close();
    }

    const b = startDaemon(homeB, controlB, peerB);
    daemons.push(b);
    await b.waitForStderr(/waiting for a chain \(control port \d+\)/, START_TIMEOUT_MS);

    const clientB = await ControlClient.connect(controlB);
    clients.push(clientB);

    const joinedReply = clientB.next(
      (frame) => frameType(frame) === "chain" || frameType(frame) === "control_error",
      "the join_chain reply",
    );
    clientB.send({ t: "join_chain", code: invite });
    const joined = await joinedReply;
    assert.equal(frameType(joined), "chain", `join_chain failed: ${JSON.stringify(joined)}`);
    const joinedChain = joined["chain"];
    if (typeof joinedChain !== "string") {
      throw new Error(`join_chain returned no chain id: ${JSON.stringify(joined)}`);
    }
    assert.equal(joinedChain, chain, "the joining daemon adopted a different chain id");

    const converged = await waitFor(
      async () => {
        const stateA = await requestState(clientA);
        const stateB = await requestState(clientB);
        const headA = stateNumber(stateA, "head");
        const headB = stateNumber(stateB, "head");
        if (headA !== headB) return null;
        if (headA < 1) return null;
        return { stateA, stateB, head: headA };
      },
      "both daemons to report the same non-empty head",
      REPLICATION_TIMEOUT_MS,
    );

    assert.equal(converged.head, 1, "both daemons should hold exactly the one seeded event");
    assert.equal(stateString(converged.stateA, "chain"), chain);
    assert.equal(stateString(converged.stateB, "chain"), chain);
    assert.notEqual(
      stateString(converged.stateA, "node"),
      stateString(converged.stateB, "node"),
      "the two daemons must have distinct node ids",
    );

    // The head alone could match by accident if B lost the event and both read
    // zero, so check the actual bytes on both sides of the wire.
    const finalA = EventStore.open(join(homeA, "workspace", "chain.db"));
    const finalB = EventStore.open(join(homeB, "workspace", "chain.db"));
    try {
      const eventsA = finalA.read(chain, 1, 10);
      const eventsB = finalB.read(chain, 1, 10);
      assert.equal(eventsA.length, 1);
      assert.equal(eventsB.length, 1);
      assert.equal(eventsB[0]?.id, eventsA[0]?.id);
      assert.equal(eventsB[0]?.seq, eventsA[0]?.seq);
      assert.deepEqual(eventsB[0]?.data, eventsA[0]?.data);
    } finally {
      finalA.close();
      finalB.close();
    }
  },
);
