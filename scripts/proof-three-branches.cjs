#!/usr/bin/env node
/**
 * Three real daemons, one chain: a proof that concurrent branches converge.
 *
 *   A creates the chain, B and C join it. Then A appends one more event (the
 *   "backflow": a local append *after* the join has to reach the joiners), and
 *   finally B and C append at the same moment. Afterwards every one of the
 *   three chain databases has to hold all of it, with the mirror order
 *   preserved per node: each writer keeps its own branch first.
 *
 * Nothing here is mocked. The daemons are the built ones (`dist/daemon/main.js`),
 * driven over their websocket control ports, and the result is read straight
 * from each `state/chain.db` with `node:sqlite`.
 *
 *   npm run build && node scripts/proof-three-branches.cjs
 *
 * Exit code 0 and a final PASS line on success; a message about what diverged
 * and exit code 1 otherwise.
 */

const { spawn } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const WebSocket = require("ws");

const ROOT = join(__dirname, "..");
const DAEMON = join(ROOT, "dist", "daemon", "main.js");

/** Three nodes on one machine: separate homes, separate control and peer ports. */
const NODES = [
  { key: "a", control: 17_411, peer: 17_421 },
  { key: "b", control: 17_412, peer: 17_422 },
  { key: "c", control: 17_413, peer: 17_423 },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function fail(message) {
  throw new Error(message);
}

async function waitFor(what, fn, timeoutMs = 25_000) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) fail(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** One daemon plus a control socket that keeps the latest `state` frame. */
class Daemon {
  constructor(spec, home) {
    this.key = spec.key;
    this.controlPort = spec.control;
    this.peerPort = spec.peer;
    this.home = home;
    this.logPath = join(home, "daemon.log");
    this.state = null;
    this.chainReply = null;
    this.child = null;
    this.socket = null;
  }

  async start() {
    mkdirSync(this.home, { recursive: true });
    const env = {
      ...process.env,
      ROAN_HOME: this.home,
      ROAN_CONTROL_PORT: String(this.controlPort),
      ROAN_PEER_PORT: String(this.peerPort),
      ROAN_PEER_BIND: "lan",
      ROAN_DISCOVERY: "off",
    };
    const child = spawn(process.execPath, [DAEMON], { env, stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    child.stderr.pipe(createWriteStream(this.logPath, { flags: "a" }));
    child.on("exit", (code) => {
      this.exitCode = code ?? 0;
    });
    await waitFor(`${this.key}: control port`, async () => {
      try {
        await this.connect();
        return true;
      } catch {
        return false;
      }
    });
    await waitFor(`${this.key}: first state`, () => this.state !== null);
    return this;
  }

  /** Connects once and stays connected; frames keep arriving in the background. */
  async connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${String(this.controlPort)}`);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    this.socket = socket;
    socket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (frame.t === "state") this.state = frame.data;
      if (frame.t === "chain") this.chainReply = frame;
    });
    socket.send(JSON.stringify({ t: "state" }));
  }

  send(frame) {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      fail(`${this.key}: control socket is not open`);
    }
    this.socket.send(JSON.stringify(frame));
  }

  /** Asks for a fresh state frame instead of trusting the last pushed one. */
  async refreshState() {
    this.send({ t: "state" });
    await sleep(250);
    return this.state;
  }

  async stop() {
    try {
      this.socket?.close();
    } catch {
      // already gone
    }
    const child = this.child;
    if (child === null || this.exitCode !== undefined) return;
    child.kill("SIGTERM");
    const gone = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      sleep(5_000).then(() => false),
    ]);
    if (!gone) child.kill("SIGKILL");
  }

  /** The chain database this daemon holds, as `{seq, id, node, type, data}` rows. */
  chainRows() {
    const path = join(this.home, "state", "chain.db");
    if (!existsSync(path)) fail(`${this.key}: no chain database at ${path}`);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      return db.prepare("SELECT seq, id, node, type, data FROM events ORDER BY seq ASC").all();
    } finally {
      db.close();
    }
  }

  tail(lines = 20) {
    try {
      return readFileSync(this.logPath, "utf8").split("\n").slice(-lines).join("\n");
    } catch {
      return "(no log)";
    }
  }
}

function describe(rows) {
  return rows
    .map((row) => `${String(row.seq)}:${row.type}@${String(row.node).slice(0, 10)}:${String(row.id).slice(0, 8)}`)
    .join(" ");
}

function ids(rows) {
  return new Set(rows.map((row) => row.id));
}

/** The session id inside a `session` event's data, or null. */
function sessionOf(row) {
  if (row.type !== "session") return null;
  try {
    const data = JSON.parse(String(row.data));
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

/** The label inside a `checkpoint` event's data, or null. */
function labelOf(row) {
  if (row.type !== "checkpoint") return null;
  try {
    const data = JSON.parse(String(row.data));
    return typeof data.label === "string" ? data.label : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(DAEMON)) fail(`no built daemon at ${DAEMON}; run npm run build first`);
  const root = mkdtempSync(join(tmpdir(), "roan-proof-"));
  const daemons = NODES.map((spec) => new Daemon(spec, join(root, spec.key)));
  const [a, b, c] = daemons;

  try {
    for (const daemon of daemons) await daemon.start();
    console.log(`three daemons up under ${root}`);

    // --- A creates the chain -------------------------------------------------
    a.send({ t: "create_chain" });
    const created = await waitFor("A: chain created", () => a.chainReply);
    if (created.t !== "chain") fail(`A: create_chain answered ${JSON.stringify(created)}`);
    const invite = await waitFor("A: invite code", async () => (await a.refreshState())?.invite ?? null);

    // A little history before anyone joins, so catching up is not trivial.
    a.send({ t: "checkpoint", label: "before-join" });
    await waitFor("A: the pre-join checkpoint", () => a.chainRows().some((row) => labelOf(row) === "before-join"));

    // --- B and C join --------------------------------------------------------
    for (const joiner of [b, c]) {
      joiner.send({ t: "join_chain", code: invite });
      await waitFor(`${joiner.key}: joined`, () => joiner.chainReply);
    }

    const beforeJoin = a.chainRows().length;
    await waitFor(
      "B and C to catch up with A",
      () => b.chainRows().length >= beforeJoin && c.chainRows().length >= beforeJoin,
    );
    console.log(
      `joined: A=${String(a.chainRows().length)} B=${String(b.chainRows().length)} C=${String(c.chainRows().length)}`,
    );

    // --- the backflow: a local append AFTER the join has to reach the joiners
    a.send({ t: "checkpoint", label: "after-join" });
    await waitFor("A's post-join event to reach B and C", () =>
      [b, c].every((daemon) => daemon.chainRows().some((row) => labelOf(row) === "after-join")),
    );
    console.log("backflow: A's event appended after the join reached both joiners");

    // --- B and C append at the same moment -----------------------------------
    b.send({ t: "new_session", title: "branch-b" });
    c.send({ t: "new_session", title: "branch-c" });

    const ownBranch = (daemon) => {
      const found = daemon.chainRows().filter((row) => row.node === daemon.state.node && sessionOf(row) !== null);
      return found[found.length - 1];
    };
    await waitFor("all three chains to hold both branches", () => {
      const bBranch = ownBranch(b);
      const cBranch = ownBranch(c);
      if (bBranch === undefined || cBranch === undefined) return false;
      return daemons.every((daemon) => {
        const held = ids(daemon.chainRows());
        return held.has(bBranch.id) && held.has(cBranch.id);
      });
    });

    // Let the last relayed branch settle before reading the final order.
    let lastSignature = "";
    await waitFor("the three chains to stop changing", () => {
      const signature = daemons.map((daemon) => describe(daemon.chainRows())).join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        return false;
      }
      return true;
    });

    const rows = new Map(daemons.map((daemon) => [daemon.key, daemon.chainRows()]));
    for (const [key, list] of rows) console.log(`${key}: ${describe(list)}`);

    // --- both branches on every node, mirrored where the writer is ----------
    const bBranch = ownBranch(b);
    const cBranch = ownBranch(c);
    if (bBranch === undefined) fail("B did not write a branch of its own");
    if (cBranch === undefined) fail("C did not write a branch of its own");

    for (const [key, list] of rows) {
      const held = ids(list);
      if (!held.has(bBranch.id)) fail(`${key} is missing B's branch ${bBranch.id}`);
      if (!held.has(cBranch.id)) fail(`${key} is missing C's branch ${cBranch.id}`);
      list.forEach((row, index) => {
        if (row.seq !== index + 1) fail(`${key} is not contiguous at index ${index}: seq ${row.seq}`);
      });
    }

    const position = (list, id) => list.findIndex((row) => row.id === id);
    if (position(rows.get("b"), bBranch.id) > position(rows.get("b"), cBranch.id)) {
      fail("B holds C's branch before its own; the mirror order is broken");
    }
    if (position(rows.get("c"), cBranch.id) > position(rows.get("c"), bBranch.id)) {
      fail("C holds B's branch before its own; the mirror order is broken");
    }

    // --- presence: nobody is offline in their own node list ------------------
    await waitFor(
      "every daemon to announce itself into the roster",
      async () => {
        const rosters = [];
        for (const daemon of daemons) {
          const state = await daemon.refreshState();
          rosters.push(new Set((state.nodes ?? []).map((entry) => entry.node)));
        }
        return rosters.every((roster) => roster.size >= daemons.length);
      },
      30_000,
    );
    for (const daemon of daemons) {
      const state = await daemon.refreshState();
      const mine = (state.nodes ?? []).find((entry) => entry.node === state.node);
      if (mine === undefined) fail(`${daemon.key} does not list itself in its own node list`);
      if (mine.live !== true) fail(`${daemon.key} lists itself as offline while its daemon runs`);
      const others = (state.nodes ?? []).filter((entry) => entry.node !== state.node);
      if (others.length === 0) fail(`${daemon.key} lists no other node; the join announced nobody`);
    }

    console.log(
      `branches: B ${String(bBranch.id).slice(0, 8)} and C ${String(cBranch.id).slice(0, 8)} on all three nodes, mirror order kept`,
    );
    console.log("PASS");
  } catch (error) {
    for (const daemon of daemons) {
      if (daemon.child === null) continue;
      try {
        console.log(`--- ${daemon.key} rows ---`);
        console.log(describe(daemon.chainRows()));
      } catch {
        // the database may not exist yet
      }
      console.log(`--- ${daemon.key} log tail ---`);
      console.log(daemon.tail(25));
    }
    throw error;
  } finally {
    for (const daemon of daemons) await daemon.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("FAIL: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
