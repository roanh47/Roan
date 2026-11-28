import { randomUUID } from "node:crypto";
import { EventStore } from "../chain/store.js";
import type { ChainResponse, DaemonState } from "./control-protocol.js";
import { decodeJoinCode, encodeJoinCode } from "./control-protocol.js";
import { createIdentity, loadIdentity, type Identity } from "./identity.js";
import { ensurePaths, migrateLegacyHome, migrateStateSplit, resolvePaths, type RoanPaths } from "./paths.js";
import { advertiseHost, advertiseHosts, resolvePeerBind, type PeerBind } from "./advertise.js";
import { leaveChain } from "./leave.js";
import { ensureBootstrapFiles, readGuideFile } from "./bootstrap.js";
import { ANDROID_STORAGE_TARGETS, openStorageWindow, sharedStorageProbe } from "./storage-window.js";
import { compactMessages } from "../chain/compaction.js";
import { loadSettings } from "./settings.js";
import { startControlServer } from "./control.js";
import { loadDeviceAccess, mayControl, mayLoadUi, saveDeviceAccess } from "./device-access.js";
import { ChainNodeStore } from "./peer-store.js";
import { addPeer, peers as peerList, PEER_PATH, startPeers, stopPeers } from "./peers.js";
import { probe, startDiscovery, tailscaleHosts } from "./discovery.js";
import { foldNodeRoster, nodesFromEvents, readNodes } from "../chain/nodes.js";
import os from "node:os";
import { createHash } from "node:crypto";
import type { Logger } from "../sync/types.js";
import { Presence } from "../sync/presence.js";
import { runTurn } from "./turn-runner.js";
import { allTools } from "../tools.js";
import { loadWebConfig, setWebConfigSource } from "../web/config.js";
import { loadPlugins } from "../plugins/index.js";
import { contextTools } from "../tools/context-tools.js";
import { MemoryStore } from "../context/memory.js";
import { SkillLibrary } from "../context/skills.js";
import { buildSystemPrompt } from "../context/prompt.js";
import { adoptEnv, adoptEnvEvent, latestEnv, publishEnv } from "./env-sync.js";
import { dirname, join, resolve } from "node:path";
import { createRunOnNodeTool, serveDelegation, type RelayOptions } from "./relay.js";
import { autoTitleFor, readSessions, sessionMessages } from "../chain/sessions.js";
import { openSession } from "./session-open.js";
import { removeNode } from "./membership.js";
import { foldGoals, goalContext } from "../chain/goals.js";
import { parseCommandLine, resolveMessage } from "../chain/commands.js";
import {
  SKILL_APPROVAL_KIND,
  SKILL_PROPOSAL_EVENT,
  SKILL_REJECTION_KIND,
  foldSkillProposals,
} from "../skills/fold.js";
import { createSkillProposeTool, installSkill } from "../skills/propose-tool.js";
import { searchStoreMemories } from "../knowledge/search.js";
import { createMemorySearchTool, createTodoTool } from "../tools/recall-tools.js";
import { TodoStore } from "../tools/todo.js";
import { ProcessRegistry, createProcessTool, finishedJobsNote } from "../tools/processes.js";
import { distilMemories, memoryTexts } from "../memory/index.js";
import { foldMemoryMd, writeMemoryMd } from "../context/memory-md.js";
import { approvePlan, planModeEnabled, planModeEvent } from "./plan.js";
import { createSteerInbox, type SteerInbox } from "../turn/index.js";
import { chat } from "../provider.js";
import { discoverInstructionFiles } from "../import/discover.js";
import { toSnapshotEntries } from "../import/parse.js";
import { planImport } from "../import/apply.js";
import { collectEnvEntries } from "../env/pack.js";
import { listWorkspace, readWorkspaceFile } from "../workspace/library.js";
import { renderConversationHtml } from "../chain/export-html.js";
import { VERSION } from "../version.js";
import { setFullDiskAccess } from "../tools.js";
import { checkGithubAndPrepareUpdate } from "../packaging/update-flow.js";
import { exportChain } from "../chain/export.js";
import { sessionAttachments, sessionMarkdown } from "../chain/export-markdown.js";
import { diffWorkspace, hashContent, scanWorkspace, type FileEntry } from "../workspace/scan.js";
import { applyWorkspaceEvent } from "../workspace/sync.js";
import { blobChunks, BlobSlate, hashBuffer, parseBlobEvent } from "../workspace/blob.js";
import { randomUUID as uuid } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile as readFileAsync, rm, writeFile as writeFileAsync } from "node:fs/promises";
import { runHooks, type HookConfig } from "../hooks/run.js";
import { guardTool, type ApprovalAnswer, type GuardOptions } from "../tools/guard.js";
import { dueJobs, loadCron, unparseableSchedule } from "../cron/jobs.js";
import { isEffortLevel } from "../providers/effort.js";
import { runMiniRoan } from "./mini.js";
import { buildAdapter } from "../agent.js";
import type { ProviderConfig } from "../providers/adapter.js";
import {
  describeImagePrompt,
  isAuxSlot,
  resolveAux,
  withAuxModel,
  withImageDescription,
  type AuxSlot,
} from "./auxiliary.js";
import { McpRuntime } from "./mcp-runtime.js";
import { approvedToolsFromEvents, mcpServersFromEvents, toolRulesFromEvents } from "../chain/gates.js";
import type { Tool } from "../types.js";
import { catalogSource, loadCatalog } from "../providers/live.js";
import { presetsFromCatalog, fetchModels, loadProviders, saveProviders, upsertAccount, type ProviderAccount } from "./providers.js";
import { saveSettings } from "./settings-write.js";

/**
 * One port for everything this machine serves: the built web UI over HTTP, the
 * control socket on `/ws`, and peer sync on `/peer`. `ROAN_CONTROL_PORT` and
 * `ROAN_CONTROL_HOST` are the old names for the same two settings and still
 * work, so an existing unit file keeps starting.
 */
const PORT = Number(process.env["ROAN_PORT"] ?? process.env["ROAN_CONTROL_PORT"] ?? 6769);
// Listen on every interface: an app on a phone, a laptop and a server has to be
// reachable from the same machine (loopback) and from the tailnet at once.
const HOST = process.env["ROAN_HOST"] ?? process.env["ROAN_CONTROL_HOST"] ?? "0.0.0.0";

/** The last stretch of the daemon's own output, served at `/log` on the port. */
const LOG_RING_CHARS = 64 * 1024;

const SYSTEM_PROMPT = [
  "You are Roan, an agent running on one of the user's machines.",
  "You work inside the user's folder and you have tools to read, write, search and run commands.",
  "Read a file before you change it. Never invent file contents.",
  "Run the build or the tests after changing something, and report what actually happened.",
].join("\n");

interface Session {
  readonly identity: Identity;
  readonly store: EventStore;
}

/**
 * Where the one port listens, phrased the way the invite and the announcement
 * understand it. The daemon binds every interface (`0.0.0.0`) unless the
 * operator narrowed it with `ROAN_HOST` (an address, or `lan` / `tailscale`).
 */
function peerBind(): PeerBind {
  const choice = HOST.trim();
  if (choice === "lan" || choice === "tailscale") return resolvePeerBind(os.networkInterfaces(), { ROAN_PEER_BIND: choice });
  if (choice === "0.0.0.0" || choice === "::") return { kind: "lan" };
  if (choice === "127.0.0.1" || choice === "localhost" || choice === "::1") return { kind: "loopback" };
  return { kind: "address", address: choice };
}

/**
 * Every address on which another device can call this device, best first — and
 * never more than the bind exposes. A loopback-only daemon advertises nothing,
 * because a peer that dials it would hit its own machine: sync needs a wider
 * bind, and the invite says so by being absent.
 */
function dialHosts(): string[] {
  return advertiseHosts(peerBind(), os.networkInterfaces());
}

/** Discovery belongs to the process, not to a session: it has to stop on shutdown. */
let stopDiscovery: (() => void) | null = null;

const peerLogger: Logger = {
  debug: () => undefined,
  info: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
  warn: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
  error: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
};

/**
 * The daemon's output goes to stderr (the Android service tails it) and to a
 * bounded ring, which `/log` serves over the same port as everything else.
 * There is no log server and no log port: one process, one listener.
 */
const logRing: string[] = [];
let logRingChars = 0;

function log(message: string): void {
  process.stderr.write(message + "\n");
  logRing.push(message);
  logRingChars += message.length + 1;
  while (logRingChars > LOG_RING_CHARS && logRing.length > 1) {
    const dropped = logRing.shift() ?? "";
    logRingChars -= dropped.length + 1;
  }
}

interface AgentContext {
  readonly memory: MemoryStore;
  readonly skills: SkillLibrary;
  readonly tools: readonly import("../types.js").Tool[];
  /** Base prompt plus everything this device has learned, rebuilt every turn. */
  prompt(): Promise<string>;
}

async function main(): Promise<void> {
  const paths = resolvePaths();
  // The capital-R move happens before anything opens the database, so an
  // upgrade from a pre-capital install keeps its chain without noticing.
  const migration = await migrateLegacyHome(paths);
  // The chain database moves into `state/` once, before anything opens it:
  // `workspace/` becomes the agent's desk instead of a bookkeeping floor.
  // The web section (<home>/web.json) is per machine and read at call time:
  // the tools never cache it, so a provider change applies on the next call.
  setWebConfigSource(() => loadWebConfig(paths.home));
  // Bundled plugins now, home plugins (<home>/plugins/<id>/plugin.json) after.
  // A broken plugin is reported and skipped; boot never depends on one.
  await loadPlugins(paths.home);
  const stateSplit = await migrateStateSplit(paths);
  if (stateSplit === "moved") log("home: chain database moved to state/");
  const bootstrapped = await ensureBootstrapFiles(paths);
  if (bootstrapped.length > 0) log("home: wrote " + bootstrapped.join(", ") + " (first start)");
  if (migration === "moved") log("home: moved the old ~/.roan to ~/.Roan once");
  else if (migration === "both") log("home: ~/.Roan exists and an old ~/.roan is still there; leaving it alone");
  await ensurePaths(paths);
  // Reassigned when a snapshot from the chain lands: the key and the model
  // travel in `config.json`, so a device that joins mid-run has to pick them up
  // without a restart.
  let settings = await loadSettings(paths);
  // The file tools resolve paths through the policy, so the setting has to be
  // live in this process from the first turn, not just written to disk.
  setFullDiskAccess(settings.access.fullDisk);

  // Everything this device knows before the first token: its own memory files
  // and the skills on its own disk. Both are copies, never a fetch from a peer.
  // Who may reach this device from outside the app; local to this machine.
  let deviceAccess = await loadDeviceAccess(paths.state);
  const memory = new MemoryStore(paths.home);
  const skills = new SkillLibrary(join(paths.home, "skills"));
  // Background jobs belong to this machine and this daemon run.
  const processes = new ProcessRegistry();
  const tools = [...allTools(), ...contextTools(memory, skills), createProcessTool(processes)];
  // MCP servers are chain config: this node dials them, every instance folds
  // the same list. Unreachable servers are skipped, never fatal.
  const mcp = new McpRuntime((line) => log(line));
  const agentContext: AgentContext = {
    memory,
    skills,
    tools,
    prompt: async () =>
      buildSystemPrompt({
        base: SYSTEM_PROMPT,
        soul: await readGuideFile(paths, "SOUL.md"),
        rules: await readGuideFile(paths, "AGENTS.md"),
        user: await memory.render("user"),
        memory: await memory.render("memory"),
        skills: await skills.index(),
      }),
  };

  let session: Session | null = null;
  const identity = await loadIdentity(paths);
  if (identity) session = { identity, store: EventStore.open(paths.database) };

  /**
   * Who is alive in this chain. The local node never depends on a heartbeat:
   * while this process runs it is live, and its head is the chain on this disk.
   * A peer counts as live when it is connected right now or spoke within the
   * TTL, so an idle machine is not mistaken for a gone one.
   */
  let presence: Presence | null = null;
  const presenceNow = (): Presence | null => {
    if (session === null) return null;
    const current = session;
    if (presence === null || presence.self !== current.identity.nodeId || presence.chain !== current.identity.chainId) {
      presence = new Presence({
        self: { node: current.identity.nodeId, chain: current.identity.chainId },
      });
    }
    presence.seeSelf(current.store.head(current.identity.chainId));
    return presence;
  };

  const state = (): DaemonState => {
    const connected = peerList();
    const who = presenceNow();
    const self = session?.identity.nodeId ?? null;
    return {
      model: settings.model,
      provider: settings.provider,
      onboarding: session === null,
      sessions:
        session === null
          ? []
          : readSessions(session.store.read(session.identity.chainId, 1, 10_000)).sessions.map((s) => ({
              id: s.id,
              title: s.title,
              messages: s.messages,
              ...(s.ephemeral ? { ephemeral: true } : {}),
            })),
      activeSession:
        session === null
          ? null
          : (readSessions(session.store.read(session.identity.chainId, 1, 10_000)).active?.id ?? null),
      chain: session?.identity.chainId ?? null,
      node: self,
      head: session ? session.store.head(session.identity.chainId) : 0,
      peers: connected,
      nodes:
        session === null
          ? []
          : nodesFromEvents(session.store.read(session.identity.chainId, 1, 100_000)).map((n) => ({
              node: n.node,
              name: n.name,
              host: n.host,
              port: n.port,
              // This machine is live by definition; a peer that is connected
              // right now or spoke within the TTL is too. Nothing here makes
              // the local node depend on hearing from someone else.
              live: n.node === self || connected.includes(n.node) || (who?.isLive(n.node) ?? false),
            })),
      invite: session === null ? null : joinCode(session.identity),
    };
  };

  /**
   * The code another device pastes in, or null when there is nothing to paste:
   * a loopback-only daemon has no address another machine can dial, and a code
   * without one is a lie that fails at the first handshake.
   */
  function joinCode(identity: Identity): string | null {
    const hosts = dialHosts();
    if (hosts.length === 0) return null;
    return encodeJoinCode({ v: 2, chain: identity.chainId, token: identity.token, hosts, port: PORT });
  }

  let control: Awaited<ReturnType<typeof startControlServer>> | null = null;
  /** The turn in flight, so "stop" has something to abort. */
  let activeTurn: AbortController | null = null;
  let activeSteer: SteerInbox | null = null;
  let replicating = false;

  /**
   * Opens the peer link for the chain in `session`. Runs once per process: the
   * replication layer keeps a single listener, and starting it twice would mean
   * two servers on the same port.
   */
  /**
   * The honest way out. On a supervised shell (systemd, the Android service)
   * exiting is fine; on the Android shell `process.exit` from the node thread
   * tears down static destructors mid-flight and kills the whole app with a
   * SIGABRT — the crash from the earlier rounds. There the servers close, the
   * event loop drains, the thread returns to its supervisor, and the process
   * stays whole.
   */
  const stopDaemon = async (reason: string): Promise<void> => {
    log("daemon: stopping (" + reason + ")");
    try {
      await control?.close();
    } catch {
      // already closed or a socket refusing politely; the loop drains either way
    }
    await stopPeers().catch(() => undefined);
    if (process.env["ROAN_SHELL"] === "android") return;
    process.exit(0);
  };

  const startReplication = async (): Promise<void> => {
    if (session === null || replicating) return;
    const node = new ChainNodeStore(session.store, session.identity.nodeId, session.identity.chainId);
    // A tool request that another device addressed to us arrives as a replicated
    // event; it is carried out here, on this machine, and answered in the chain.
    node.watchApplied((event) => {
      // A peer that just appended is alive, and its event says how far it is.
      presenceNow()?.seeEvent(event);
      // Everything a peer appends is as real here as on the device that wrote
      // it: the app windows on this machine see the message live, and session
      // metadata (a new conversation, a rename) also refreshes the drawer.
      const chainEvent = event as unknown as import("../protocol/types.js").Event;
      control?.broadcast({ t: "append", event: chainEvent });
      if (
        chainEvent.type === "session" ||
        chainEvent.type === "session_title" ||
        chainEvent.type === "node" ||
        chainEvent.type === "node_remove"
      ) {
        control?.sendState();
      }
      if (chainEvent.type === "node_remove") {
        // A tombstone is a statement about a device that stopped answering. If
        // it names this device, then this device is answering right now, so it
        // announces itself again: a live device is not a ghost. That is also
        // how a machine that was removed while it was away comes back the
        // moment it connects and catches up.
        const target = (chainEvent.data as { node?: unknown } | null)?.node;
        if (typeof target === "string" && target === session?.identity.nodeId) {
          void announceNode().catch((error: unknown) => log("node: " + String(error)));
        }
      }
      if (event.type === "blob") {
        blobSlate.add(chainEvent);
        return;
      }
      if (event.type === "workspace") {
        void applyWorkspaceEvent(paths.syncedWorkspace, event as never, blobSlate)
          .then((outcome) => {
            if (outcome.kind === "conflict") {
              log(`workspace: conflict on ${outcome.path}, both versions kept`);
            }
          })
          .catch((error: unknown) => log("workspace: " + String(error)));
      }
      const relayNow = relayOptions();
      if (relayNow === null) return;
      void serveDelegation(relayNow, event as unknown as import("../protocol/types.js").Event).catch((error: unknown) =>
        log("relay: " + String(error)),
      );
    });
    await startPeers({
      store: node,
      token: session.identity.token,
      logger: peerLogger,
      onError: (error) => log("peer error: " + error.message),
      // Peers ride the same port as the app: `/peer` on the control server,
      // no second listener.
      mount: (handler) => control?.mountUpgrade(PEER_PATH, handler) ?? (() => undefined),
    });
    replicating = true;
    log("peer: mounted on " + HOST + ":" + String(PORT) + PEER_PATH);
    // Every machine finds the other via Tailscale. That way nobody has to paste
    // a code and the cluster comes back after a restart or a new IP too.
    if (process.env["ROAN_DISCOVERY"] !== "off" && stopDiscovery === null) {
      stopDiscovery = startDiscovery({
        port: PORT,
        logger: peerLogger,
        onCandidate: (host) => {
          try {
            addPeer(`${host}:${String(PORT)}`);
          } catch (error: unknown) {
            log("discovery: could not add peer: " + String(error));
          }
        },
      });
    }
  };

  // Peer sync is mounted on the control server, so it starts once that server
  // exists — at the end of main(), next to `startControlServer`.

  /**
   * Keeps this device's copy equal to the chain: adopt what is newer, publish
   * what changed here. Runs on start and then quietly on a timer, so editing a
   * skill is enough — no command, no restart.
   */
  /**
   * Tells the chain who this machine is: a name a person would say, and the
   * address a peer can dial. One event per change, so a moved address shows up
   * and a restart does not fill the chain with the same announcement.
   */
  const announceNode = async (): Promise<void> => {
    if (session === null) return;
    const current = session;
    const chain = current.identity.chainId;
    // One source of truth for "where can you call me": the same address the
    // invites carry. The tailscale scan stays for the discovery list; the
    // announcement uses the dialable host, tailnet first.
    const bind = peerBind();
    let host = advertiseHost(bind, os.networkInterfaces());
    if (host.length === 0 && bind.kind !== "loopback") {
      // A loopback-only daemon has no address a peer could dial, and naming the
      // tailnet address anyway would be a route to a door that is not there.
      const found = await tailscaleHosts().catch(() => ({ self: null, hosts: [] as string[] }));
      host = found.self ?? "";
    }
    const data = { node: current.identity.nodeId, name: os.hostname(), host, port: PORT };
    const id = `node-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
    const events = current.store.read(chain, 1, 100_000);
    const announced = events.some((event) => event.id === id);
    // A restart must not fill the chain with the same announcement again, but a
    // removal must not outlive a live device either: when this node is
    // tombstoned the same fact is written once more under a fresh event id, and
    // the fold takes the newest statement. That is how a device that was removed
    // while it was away comes back the moment it runs (and connects) again.
    if (announced && !foldNodeRoster(events).removed.has(data.node)) return;
    const event = current.store.append(chain, {
      id: announced ? uuid() : id,
      node: current.identity.nodeId,
      type: "node",
      data,
    });
    control?.broadcast({ t: "append", event });
    control?.sendState();
    log(
      `node: announced ${data.name}${host.length > 0 ? " at " + host : " without an address"}` +
        (announced ? " (back in the chain)" : ""),
    );
  };

  const syncEnv = async (): Promise<void> => {
    if (session === null) return;
    const current = session;
    const chain = current.identity.chainId;
    const known = latestEnv(current.store, chain);
    // A snapshot this device wrote itself is older than what is on its disk by
    // definition: adopting it would delete the edit that made it stale. Only a
    // peer's snapshot is allowed to overwrite what is here.
    if (known !== null && known.nodeId !== current.identity.nodeId) {
      const result = await adoptEnv(known, paths.home);
      if (result.applied) {
        log("env: adopted the chain's copy");
        // `config.json` arrived with the chain, so the provider, the model and
        // the key it carries have to work from now on — not after a restart.
        settings = await loadSettings(paths);
        log("env: settings reloaded from the chain");
      }
    }
    await announceNode().catch((error: unknown) => log("node: " + String(error)));
    const result = await publishEnv({
      store: current.store,
      chain,
      node: current.identity.nodeId,
      home: paths.home,
    });
    if (result.published) log("env: published " + result.hash.slice(0, 12));
  };

  // Started on boot when there is already a chain, and again the moment one is
  // created or joined — a fresh install must not wait for a restart to sync.
  let envTimer: NodeJS.Timeout | null = null;
  const startEnvLoop = async (): Promise<void> => {
    if (session === null) return;
    await syncEnv().catch((error: unknown) => log("env: " + String(error)));
    if (envTimer !== null) return;
    envTimer = setInterval(() => {
      void syncEnv().catch((error: unknown) => log("env: " + String(error)));
    }, 10_000);
    envTimer.unref();
  };

  /**
   * Files travel the same way the env does: as content in the chain, written
   * out on every device. The scan is what notices an edit, so nothing in the
   * app has to know a file changed.
   */
  let workspaceKnown: Map<string, FileEntry> | null = null;
  let workspaceTimer: NodeJS.Timeout | null = null;
  /** Chunks that arrived, waiting for the put that points at them. */
  const blobSlate = new BlobSlate();
  let blobKnown: Map<string, FileEntry> = new Map();

  const publishWorkspace = async (): Promise<void> => {
    if (session === null) return;
    const current = session;
    const root = paths.syncedWorkspace;
    const scanned = await scanWorkspace(root);
    if (workspaceKnown === null) {
      workspaceKnown = scanned.files;
      blobKnown = new Map(scanned.blobs);
      return;
    }
    const before = workspaceKnown;
    const { puts, deletes } = diffWorkspace(before, scanned.files);
    for (const entry of puts) {
      const content = await readFileAsync(join(root, entry.path), "utf8");
      const base = before.get(entry.path)?.hash;
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "workspace",
        data: { op: "put", path: entry.path, content, hash: entry.hash, ...(base !== undefined ? { base } : {}) },
      });
    }
    for (const path of deletes) {
      const gone = before.get(path)?.hash;
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "workspace",
        data: { op: "delete", path, ...(gone !== undefined ? { base: gone } : {}) },
      });
    }
    // The blob channel: big or binary files travel as hashed chunks with the
    // put pointing at them, so sharing does not stop at the text cap.
    const { puts: blobPuts } = diffWorkspace(blobKnown, scanned.blobs);
    for (const entry of blobPuts) {
      const buffer = await readFileAsync(join(root, entry.path));
      const hash = hashBuffer(buffer);
      for (const part of blobChunks(buffer)) {
        const chunkEvent = current.store.append(current.identity.chainId, {
          id: uuid(),
          node: current.identity.nodeId,
          type: "blob",
          data: { hash, path: entry.path, ...part },
        });
        control?.broadcast({ t: "append", event: chunkEvent });
      }
      const putEvent = current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "workspace",
        data: { op: "put", path: entry.path, blobHash: hash, bytes: buffer.length },
      });
      control?.broadcast({ t: "append", event: putEvent });
    }
    blobKnown = new Map(scanned.blobs);
    workspaceKnown = scanned.files;
  };

  /** Replays every file event in the chain onto this disk, oldest first. */
  const applyChainWorkspace = async (root: string): Promise<void> => {
    if (session === null) return;
    const events = session.store.read(session.identity.chainId, 1, 100_000);
    const slate = new BlobSlate();
    for (const event of events) {
      if (event.type === "blob") slate.add(event);
    }
    for (const event of events) {
      if (event.type !== "workspace") continue;
      await applyWorkspaceEvent(root, event as never, slate);
    }
  };

  /** What the chain already says each file is, so a first scan does not repeat it. */
  const chainWorkspaceIndex = (): Map<string, FileEntry> => {
    const index = new Map<string, FileEntry>();
    for (const [path, entry] of chainBlobIndex()) index.set(path, entry);
    if (session === null) return index;
    for (const event of session.store.read(session.identity.chainId, 1, 100_000)) {
      if (event.type !== "workspace") continue;
      const data = event.data as { op?: unknown; path?: unknown; hash?: unknown; blobHash?: unknown };
      if (typeof data.path !== "string") continue;
      if (data.op === "delete") index.delete(data.path);
      else if (typeof data.hash === "string") index.set(data.path, { path: data.path, hash: data.hash, bytes: 0 });
      else if (typeof data.blobHash === "string") index.set(data.path, { path: data.path, hash: data.blobHash, bytes: 0 });
    }
    return index;
  };

  /** What the chain already says each blob file is, keyed the same way. */
  const chainBlobIndex = (): Map<string, FileEntry> => {
    const index = new Map<string, FileEntry>();
    if (session === null) return index;
    for (const event of session.store.read(session.identity.chainId, 1, 100_000)) {
      if (event.type !== "workspace") continue;
      const data = event.data as { op?: unknown; path?: unknown; blobHash?: unknown };
      if (typeof data.path !== "string") continue;
      if (data.op === "delete") index.delete(data.path);
      else if (typeof data.blobHash === "string") index.set(data.path, { path: data.path, hash: data.blobHash, bytes: 0 });
    }
    return index;
  };

  const startWorkspaceLoop = async (): Promise<void> => {
    if (session === null) return;
    if (workspaceKnown === null) workspaceKnown = chainWorkspaceIndex();
    if (blobKnown.size === 0) blobKnown = chainBlobIndex();
    await publishWorkspace().catch((error: unknown) => log("workspace: " + String(error)));
    if (workspaceTimer !== null) return;
    workspaceTimer = setInterval(() => {
      void publishWorkspace().catch((error: unknown) => log("workspace: " + String(error)));
    }, 5_000);
    workspaceTimer.unref();
  };

  /** Hooks come from a file next to the agent, so they travel with the env. */
  const loadHooks = async (): Promise<HookConfig | null> => {
    try {
      const raw = await readFileAsync(join(paths.home, "hooks.json"), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const clean: Record<string, string[]> = {};
      for (const [point, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) clean[point] = value.filter((item): item is string => typeof item === "string");
      }
      return clean;
    } catch {
      return null;
    }
  };

  /**
   * Scheduled turns. The schedule file is part of the agent, the "when did it
   * last run" file is not: every device keeps its own, so a job does not fire
   * twice because two machines are awake.
   */
  const cronStatePath = join(paths.workspace, "cron-state.json");
  const lastRun = new Map<string, number>();
  let cronTimer: NodeJS.Timeout | null = null;
  /** A bad schedule is reported once, not every thirty seconds. */
  const warnedSchedules = new Set<string>();

  const readCronState = async (): Promise<void> => {
    try {
      const raw = await readFileAsync(cronStatePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, number>;
      for (const [id, value] of Object.entries(parsed)) if (typeof value === "number") lastRun.set(id, value);
    } catch {
      // no runs yet
    }
  };

  const tickCron = async (): Promise<void> => {
    if (session === null) return;
    const jobs = await loadCron(paths.home);
    if (jobs.length === 0) return;
    // A `schedule` that does not parse is skipped, never rounded to a
    // near-enough rhythm: one line says which job and why, once.
    for (const job of unparseableSchedule(jobs)) {
      if (warnedSchedules.has(job.id)) continue;
      warnedSchedules.add(job.id);
      log(`cron: skipping "${job.title}" — cannot parse schedule "${job.schedule ?? ""}"`);
    }
    const due = dueJobs(jobs, lastRun, Date.now());
    for (const job of due) {
      lastRun.set(job.id, Date.now());
      await writeFileAsync(cronStatePath, JSON.stringify(Object.fromEntries(lastRun)), "utf8").catch(() => undefined);
      const existing = readSessions(session.store.read(session.identity.chainId, 1, 100_000)).sessions.find(
        (entry) => entry.title === job.title,
      );
      const target = existing?.id ?? startSession(job.title);
      if (target === null || target === undefined) continue;
      log(`cron: running "${job.title}"`);
      await runMessage(job.prompt, target);
    }
  };

  const startCron = async (): Promise<void> => {
    if (session === null) return;
    await readCronState();
    await tickCron().catch((error: unknown) => log("cron: " + String(error)));
    if (cronTimer !== null) return;
    cronTimer = setInterval(() => {
      void tickCron().catch((error: unknown) => log("cron: " + String(error)));
    }, 30_000);
    cronTimer.unref();
  };

  // Both loops start here, after their definitions, for a chain that already exists.
  if (session !== null) {
    await startEnvLoop();
    await startWorkspaceLoop();
    // The first cron tick uses the session helpers, which are declared below.
    setTimeout(() => {
      void startCron().catch((error: unknown) => log("cron: " + String(error)));
    }, 3_000);
  }

  /** Everything the relay needs, or null before this device has a chain. */
  const relayOptions = (): RelayOptions | null => {
    if (session === null) return null;
    return {
      store: session.store,
      chain: session.identity.chainId,
      node: session.identity.nodeId,
      tools,
      cwd: paths.syncedWorkspace,
      log: (message) => log(message),
    };
  };

  /**
   * Permission a tool asks for before it runs. The request becomes a chain
   * event — the app shows it with Approve/Deny — and the answer arrives as a
   * `tool_approve` frame. An allow is learned (the next call does not ask), a
   * deny answers this call only, a timeout refuses honestly.
   */
  const APPROVAL_TIMEOUT_MS = 180_000;
  const pendingApprovals = new Map<
    string,
    { tool: string; learn: boolean; resolve: (decision: ApprovalAnswer) => void }
  >();
  /**
   * A `reason` means the question is about this one call (a dangerous shell
   * line): the card shows why, and a yes is never learned for the whole tool.
   */
  const askPermission = (
    tool: string,
    args: Record<string, unknown>,
    reason?: string,
  ): Promise<ApprovalAnswer> => {
    if (session === null) return Promise.resolve("deny");
    const current = session;
    const req = uuid();
    const request = current.store.append(current.identity.chainId, {
      id: uuid(),
      node: current.identity.nodeId,
      type: "approval_request",
      data: { req, tool, args, ...(reason !== undefined ? { reason, once: true } : {}) },
    });
    control?.broadcast({ t: "append", event: request });
    return new Promise((resolve) => {
      pendingApprovals.set(req, { tool, learn: reason === undefined, resolve });
      setTimeout(() => {
        if (pendingApprovals.delete(req)) resolve("timeout");
      }, APPROVAL_TIMEOUT_MS);
    });
  };
  const answerApproval = (req: string, allow: boolean): { tool: string; learn: boolean } | null => {
    const pending = pendingApprovals.get(req);
    if (pending === undefined) return null;
    pendingApprovals.delete(req);
    pending.resolve(allow ? "allow" : "deny");
    return { tool: pending.tool, learn: pending.learn };
  };

  /** The `before_tool` / `after_tool` hooks of one turn, with its env. */
  const toolHooks = (
    hooks: HookConfig | null,
    extra: Record<string, string>,
  ): Pick<GuardOptions, "beforeTool" | "afterTool"> => {
    const fire = async (point: "before_tool" | "after_tool", more: Record<string, string>): Promise<void> => {
      const results = await runHooks(hooks, point, { cwd: paths.syncedWorkspace, extra: { ...extra, ...more } });
      for (const result of results) {
        if (result.exitCode !== 0) log(`hook ${point} failed (${String(result.exitCode)}): ${result.command}`);
      }
    };
    return {
      beforeTool: (tool) => fire("before_tool", { ROAN_TOOL: tool }),
      afterTool: (tool, ok) => fire("after_tool", { ROAN_TOOL: tool, ROAN_TOOL_OK: ok ? "1" : "0" }),
    };
  };

  /**
   * The tools for one turn. The chain decides what exists: rules turn tools
   * off, ask-flags gate them behind an approval, MCP servers add theirs. A
   * config that arrived from a peer dials here, at the next look.
   */
  /** How to reach the model of an auxiliary slot, or null for "the main model". */
  const auxProvider = async (slot: AuxSlot): Promise<ProviderConfig | null> => {
    if (settings.auxiliary[slot] === null) return null;
    const accounts = (await loadProviders(paths).catch(() => ({ accounts: [] }))).accounts;
    return resolveAux(
      settings.auxiliary,
      slot,
      { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, providerId: settings.provider },
      accounts,
    );
  };
  const todoLists = new Map<string, TodoStore>();
  const toolsForTurn = (
    hooks: HookConfig | null = null,
    hookEnv: Record<string, string> = {},
  ): readonly Tool[] => {
    let rules = new Map<string, { enabled: boolean; ask: boolean }>();
    let approved = new Set<string>();
    let fleet: readonly Tool[] = [];
    if (session !== null) {
      const current = session;
      const events = current.store.read(current.identity.chainId, 1, 100_000);
      const servers = mcpServersFromEvents(events);
      if (!mcp.matches(servers)) void mcp.sync(servers);
      rules = toolRulesFromEvents(events);
      approved = approvedToolsFromEvents(events);
      fleet = mcp.tools();
    }
    const visible = [...tools, ...fleet].filter((tool) => rules.get(tool.name)?.enabled !== false);
    // Every tool passes the guard: it asks when the chain says so, always asks
    // before a dangerous shell line, and fires the tool hooks around the call.
    const around = toolHooks(hooks, hookEnv);
    const gated = visible.map((tool) => {
      const rule = rules.get(tool.name);
      const ask = rule !== undefined && rule.ask && !approved.has(tool.name);
      return guardTool(tool, { ask, askPermission, ...around });
    });
    const relayNow = relayOptions();
    if (relayNow === null) return gated;
    const shared: Tool[] = [
      ...gated,
      // Guarded like the rest: a risky shell line for another device asks
      // here first, because here is where the owner can answer.
      guardTool(
        createRunOnNodeTool(relayNow, () => {
          if (session === null) return [];
          const current = session;
          return readNodes(current.store.read(current.identity.chainId, 1, 100_000));
        }),
        { ask: false, askPermission, ...around },
      ),
      // Recall: the agent looks up what was said and learned before, itself.
      createMemorySearchTool((query, limit) => {
        if (session === null) return [];
        return searchStoreMemories(session.store, session.identity.chainId, query, limit);
      }),
      // One task list per conversation, kept for as long as the daemon runs.
      createTodoTool(() => {
        const key = hookEnv["ROAN_SESSION"] ?? "";
        const found = todoLists.get(key) ?? new TodoStore();
        todoLists.set(key, found);
        return found;
      }),
      // Self-improvement: the agent may propose a skill, only the owner saves it.
      createSkillProposeTool({
        newId: () => uuid().slice(0, 8),
        append: (proposal) => {
          if (session === null) return;
          const current = session;
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: proposal.type,
            data: proposal.data,
          });
          control?.broadcast({ t: "append", event });
        },
      }),
    ];
    return [
      ...shared,
      {
        name: "delegate",
        description:
          "Hand a self-contained task to a Mini Roan: yourself, with the same skills, memory and tools, " +
          "in a context of its own. Only its summary comes back. " +
          "Use it for work that would flood this conversation.",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "What the Mini Roan must do, complete enough to stand alone" },
            cwd: { type: "string", description: "Folder to work in; the workspace by default" },
          },
          required: ["task"],
        },
        async run(args, ctx) {
          const task = String(args["task"] ?? "").trim();
          if (task.length === 0) throw new Error("task is required");
          const dir = typeof args["cwd"] === "string" ? args["cwd"] : paths.syncedWorkspace;
          // Roan's own loop, not another engine: the Mini Roan is the same
          // agent and passes the same guard, in a context nobody else reads.
          return await runMiniRoan(
            {
              // A Mini Roan may run on a model of its own; empty means the main one.
              provider: (await auxProvider("mini")) ?? {
                baseUrl: settings.baseUrl,
                apiKey: settings.apiKey,
                model: settings.model,
                providerId: settings.provider,
              },
              systemPrompt: await agentContext.prompt(),
              tools: shared,
              cwd: dir,
              effort: settings.effort,
              ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
            },
            task,
          );
        },
      },
    ];
  };

  /**
   * Which conversation this belongs to. A chain with no session yet gets one
   * named after the first thing that was said, so the list is never empty.
   */
  const resolveSession = (wanted?: string): string | null => {
    if (session === null) return null;
    const current = session;
    const index = readSessions(current.store.read(current.identity.chainId, 1, 100_000));
    if (wanted !== undefined && index.all.some((entry) => entry.id === wanted)) return wanted;
    const active = index.active;
    if (active !== null) return active.id;
    return null;
  };

  /**
   * The ids this process already handed out for a "new chat". It is what keeps
   * two presses of that button two conversations while still letting the first
   * one adopt an untouched chat that is already there.
   */
  const newSessionIssued = new Set<string>();

  const startSession = (title?: string, branchOf?: { session: string; seq: number }): string | null => {
    if (session === null) return null;
    const current = session;
    return openSession(
      current.store,
      current.identity.chainId,
      current.identity.nodeId,
      newSessionIssued,
      {
        ...(title === undefined ? {} : { title }),
        ...(branchOf === undefined ? {} : { branchOf }),
      },
    ).id;
  };

  /** A new chat from the app: adopt an untouched one, otherwise start one. */
  const openNewSession = (title?: string): string | null => {
    if (session === null) return null;
    const current = session;
    const opened = openSession(
      current.store,
      current.identity.chainId,
      current.identity.nodeId,
      newSessionIssued,
      {
        ...(title === undefined ? {} : { title }),
        reuseEmpty: true,
      },
    );
    if (opened.event !== null) control?.broadcast({ t: "append", event: opened.event });
    log(`session: ${opened.created ? "started" : "adopted"} ${opened.id.slice(0, 8)}`);
    control?.sendState();
    return opened.id;
  };

  const runMessage = async (
    text: string,
    wanted?: string,
    echoId?: string,
    image?: { mime: string; data: string },
  ): Promise<void> => {
    if (!session) return;
    const current = session;
    const sessionId = resolveSession(wanted) ?? startSession(text.slice(0, 60));
    if (sessionId === null) return;
    // A slash command the chain defines becomes its prompt here: `text` in
    // the event is what the model reads, `typed` is what the owner wrote.
    const resolved = resolveMessage(text, current.store.read(current.identity.chainId, 1, 100_000));
    const prompt = resolved.prompt;
    const stored = current.store.append(current.identity.chainId, {
      // The app's own event id, when it sent one: its pending bubble clears
      // the moment this echo arrives, instead of a second copy appearing.
      id: echoId !== undefined && echoId.length > 0 ? echoId : uuid(),
      node: current.identity.nodeId,
      type: "message",
      data: {
        text: prompt,
        ...(resolved.typed !== undefined ? { typed: resolved.typed } : {}),
        session: sessionId,
        ...(image !== undefined ? { image } : {}),
      },
    });
    control?.broadcast({ t: "append", event: stored });
    // The first turn names the conversation after what was asked: a default
    // title is a placeholder, and the rename rides the chain like any other.
    const indexAfter = readSessions(current.store.read(current.identity.chainId, 1, 100_000));
    const infoAfter = indexAfter.sessions.find((entry) => entry.id === sessionId);
    if (infoAfter !== undefined && infoAfter.messages <= 1) {
      const autoTitle = autoTitleFor(infoAfter.title, text);
      if (autoTitle !== null) {
        const named = current.store.append(current.identity.chainId, {
          id: uuid(),
          node: current.identity.nodeId,
          type: "session_title",
          data: { session: sessionId, title: autoTitle },
        });
        control?.broadcast({ t: "append", event: named });
        control?.sendState();
      }
    }
    // Standing orders ride the system prompt of every new turn: they are the
    // owner's own words, folded from the chain like everything else.
    const orders = goalContext(foldGoals(current.store.read(current.identity.chainId, 1, 100_000)));
    const basePrompt = await agentContext.prompt();
    // A background job that ended while nobody was looking is told once, to
    // the next turn that runs here.
    const finished = finishedJobsNote(processes.takeFinished());
    const systemPrompt = [orders, finished, basePrompt].filter((part) => part.length > 0).join("\n\n");
    const hooks = await loadHooks();
    const started = await runHooks(hooks, "turn_start", {
      cwd: paths.syncedWorkspace,
      extra: { ROAN_CHAIN: current.identity.chainId, ROAN_SESSION: sessionId },
    });
    for (const result of started) {
      if (result.exitCode !== 0) log(`hook turn_start failed (${String(result.exitCode)}): ${result.command}`);
    }
    const controller = new AbortController();
    const inbox = createSteerInbox();
    activeTurn = controller;
    activeSteer = inbox;
    // A main model that cannot see gets the image as words: the vision slot
    // looks at it first. When the slot is empty, or the look fails, the image
    // goes to the main model as before.
    let turnText = prompt;
    let turnImage = image;
    if (image !== undefined) {
      const vision = await auxProvider("vision");
      if (vision !== null) {
        try {
          const seen = await buildAdapter(vision).send(
            [
              {
                role: "user",
                content: [
                  { type: "text", text: describeImagePrompt(prompt) },
                  { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
                ],
              },
            ],
            { maxTokens: 1200, signal: controller.signal },
          );
          const description = typeof seen.message.content === "string" ? seen.message.content.trim() : "";
          if (description.length > 0) {
            turnText = withImageDescription(prompt, description, vision.model);
            turnImage = undefined;
          }
        } catch (error) {
          log("vision: " + (error instanceof Error ? error.message : String(error)));
        }
      }
    }
    await runTurn(
      {
        ...(turnImage !== undefined ? { image: turnImage } : {}),
        signal: controller.signal,
        store: current.store,
        chain: current.identity.chainId,
        node: current.identity.nodeId,
        provider: {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          // The id decides the adapter and how effort is spelled on the wire.
          providerId: settings.provider,
        },
        effort: settings.effort,
        fallbackModel: settings.fallbackModel,
        cwd: paths.syncedWorkspace,
        systemPrompt,
        tools: toolsForTurn(hooks, { ROAN_CHAIN: current.identity.chainId, ROAN_SESSION: sessionId }),
        planMode: planModeEnabled(current.store.read(current.identity.chainId, 1, 100_000), sessionId),
        steer: inbox,
        session: sessionId,
        onAppend: (event) => {
          control?.broadcast({ t: "append", event });
          // Skills and memory are copies on every device: an env event that
          // arrives from a peer is written here, not fetched later.
          if (event.type === "env") {
            void adoptEnvEvent(event, paths.home).then((applied) => {
              if (applied) log("env: applied a snapshot from the chain");
            });
          }
        },
      },
      turnText,
    );
    activeTurn = null;
    activeSteer = null;
    // The Android service tails the log for this line: a closed app still
    // learns that the turn of its owner is done.
    log("notify:turn-done");
    const ended = await runHooks(hooks, "turn_end", {
      cwd: paths.syncedWorkspace,
      extra: { ROAN_CHAIN: current.identity.chainId, ROAN_SESSION: sessionId },
    });
    for (const result of ended) {
      if (result.exitCode !== 0) log(`hook turn_end failed (${String(result.exitCode)}): ${result.command}`);
    }
    // Distil at most three durable facts from the finished session. A failed
    // distil never breaks the turn; the fold is a no-op when nothing changed.
    try {
      const all = current.store.read(current.identity.chainId, 1, 100_000);
      const facts = await distilMemories(
        { session: sessionId, messages: sessionMessages(all, sessionId) },
        memoryTexts(all),
        async (prompt) => {
          // Nobody reads this live, so the background slot does it when set.
          const background = await auxProvider("background");
          const answer = await chat(
            background ?? { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
            [{ role: "user", content: prompt }],
            { maxTokens: 300 },
          );
          return typeof answer.content === "string" ? answer.content : "";
        },
      );
      for (const fact of facts) {
        const event = current.store.append(current.identity.chainId, {
          id: uuid(),
          node: current.identity.nodeId,
          type: "memory",
          data: fact,
        });
        control?.broadcast({ t: "append", event });
      }
      await writeMemoryMd(paths.home, foldMemoryMd(current.store.read(current.identity.chainId, 1, 100_000)));
    } catch (error) {
      log(`memory: distil failed: ${String(error)}`);
    }
  };

  const onCreate = async (): Promise<ChainResponse> => {
    // Creating twice must not make a second chain: a double tap on the button,
    // or a client that asks again after a reconnect, would otherwise leave this
    // device with two identities and half its history in each.
    if (session !== null) {
      const existing = session.identity;
      const code = joinCode(existing);
      return {
        t: "chain",
        chain: existing.chainId,
        node: existing.nodeId,
        ...(code === null ? {} : { invite: code }),
      };
    }
    const created = await createIdentity(paths);
    session = { identity: created, store: EventStore.open(paths.database) };
    // A fresh chain has its own conversations: what was issued for the previous
    // one means nothing here.
    newSessionIssued.clear();
    const invite = joinCode(created);
    await startReplication();
    await startEnvLoop();
    await startWorkspaceLoop();
    await startCron();
    // The first conversation exists from the start: an empty session list in
    // the drawer reads as a bug, and every reference app opens a conversation
    // the moment you create an account/chain. It is a placeholder, not a
    // conversation somebody asked for, so it stays adoptable: the first "new
    // chat" takes it over instead of leaving two empty conversations behind.
    const seed = startSession("New chat");
    if (seed !== null) newSessionIssued.delete(seed);
    return { t: "chain", chain: created.chainId, node: created.nodeId, ...(invite === null ? {} : { invite }) };
  };

  const onJoin = async (code: string): Promise<ChainResponse> => {
    const parsed = decodeJoinCode(code);
    const adopted = await createIdentity(paths);
    const joined: Identity = {
      nodeId: adopted.nodeId,
      chainId: parsed.chain,
      token: parsed.token,
      createdAt: adopted.createdAt,
    };
    const { saveIdentity } = await import("./identity.js");
    await saveIdentity(paths, joined);
    session = { identity: joined, store: EventStore.open(paths.database) };
    newSessionIssued.clear();
    await startReplication();
    // Give replication a moment to hand over the chain: a joining device must
    // adopt the copy that already exists before it considers publishing its own,
    // or both ends race to write the same first events.
    setTimeout(() => {
      void (async () => {
        // A joiner takes the chain's files as its own before it publishes any.
        await applyChainWorkspace(paths.syncedWorkspace);
        await startEnvLoop();
        await startWorkspaceLoop();
        await startCron();
      })().catch((error: unknown) => log("join: " + String(error)));
    }, 2_500);
    // Every route in the code gets a peer: dead addresses sit idle, the
    // handshake refuses wrong tokens, and whichever network the two devices
    // share is the one that opens.
    for (const host of parsed.hosts) {
      addPeer({ host, port: parsed.port });
    }
    log("peer: joined via " + parsed.hosts.join(", ") + ":" + String(parsed.port));
    return { t: "chain", chain: joined.chainId, node: joined.nodeId };
  };

  control = await startControlServer({
    port: PORT,
    // One address, one port. Loopback by default: the app on this device is
    // the only caller with business on the control socket. A wider bind makes
    // the UI (and `/peer`) reachable; `/ws` still refuses everyone who is not
    // local unless ROAN_ALLOW_REMOTE_CONTROL=1 says otherwise.
    host: HOST,
    logText: () => logRing.join("\n"),
    // Read on every connection, so the switch in the app works at once.
    // The switch wins over the environment: with "this device only" on,
    // nothing but loopback opens the socket or loads the UI.
    isLocal: (address) => mayControl(deviceAccess, address, process.env["ROAN_ALLOW_REMOTE_CONTROL"] === "1"),
    allowWeb: (address) => mayLoadUi(deviceAccess, address),
    store: () => session?.store ?? null,
    state,
    onMessage: runMessage,
    onRequest: async (kind, data, reply) => {
      try {
        if (kind === "update_check" || kind === "update_download") {
          // Every platform asks its own release, and the answer is whatever the
          // release really says: no update, an update, or why it could not tell.
          const target = process.env["ROAN_PLATFORM"] ?? process.platform;
          const result = await checkGithubAndPrepareUpdate({
            currentVersion: VERSION,
            platform: target,
            arch: process.arch,
            ...(kind === "update_download" ? { dir: join(paths.home, "updates") } : { download: false }),
          });
          reply({ check: result.check, plan: result.plan, download: result.download });
          return;
        }
        if (kind === "workspace_list") {
          // Two roots the owner can look at: the free workspace and the copy that
          // syncs between devices. The hash is what makes "synced" exact, so it
          // travels with every entry.
          const wanted = data["root"] === "workspace" ? "workspace" : "synced";
          const root = wanted === "workspace" ? paths.workspace : paths.syncedWorkspace;
          const entries = await listWorkspace(root);
          const scanned = new Map<string, { hash: string }>();
          const scan = await scanWorkspace(root);
          for (const entry of scan.files.values()) scanned.set(entry.path, entry);
          reply({
            root: wanted,
            files: entries.map((entry: { path: string; bytes: number; kind: string }) => ({
              path: entry.path,
              bytes: entry.bytes,
              kind: entry.kind,
              hash: scanned.get(entry.path)?.hash ?? null,
            })),
          });
          return;
        }
        if (kind === "workspace_read") {
          const wanted = typeof data["path"] === "string" ? data["path"] : "";
          try {
            const file = await readWorkspaceFile(paths.syncedWorkspace, wanted);
            reply({ path: file.path, content: file.bytes.toString("utf8"), mime: file.mime });
          } catch (error) {
            reply({ error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (kind === "workspace_write") {
          const path = typeof data["path"] === "string" ? data["path"] : "";
          const content = typeof data["content"] === "string" ? data["content"] : null;
          if (content === null || session === null) {
            reply({ error: "no content" });
            return;
          }
          const full = resolve(paths.syncedWorkspace, path);
          if (!full.startsWith(paths.syncedWorkspace)) {
            reply({ error: "outside the workspace" });
            return;
          }
          await mkdir(dirname(full), { recursive: true });
          await writeFileAsync(full, content, "utf8");
          const hash = hashContent(content);
          const current = session;
          current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "workspace",
            data: { op: "put", path, content, hash },
          });
          // Tell the scanner this hash is already in the chain, or it would
          // publish the same file again a few seconds later.
          workspaceKnown?.set(path, { path, hash, bytes: content.length });
          reply({ ok: true, hash });
          return;
        }
        if (kind === "cron_list") {
          reply({ jobs: await loadCron(paths.home) });
          return;
        }
        if (kind === "cron_save") {
          const jobs = Array.isArray(data["jobs"]) ? data["jobs"] : [];
          await writeFileAsync(join(paths.home, "cron.json"), JSON.stringify({ jobs }, null, 2), "utf8");
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true });
          return;
        }
        if (kind === "regenerate") {
          // Regenerating is a branch, not a delete: a checkpoint marks the
          // seam, the same question is asked again, and the new answer lands
          // below the old one. Append-only stays intact.
          if (activeTurn !== null) {
            reply({ error: "a turn is running" });
            return;
          }
          const seq = typeof data["seq"] === "number" ? data["seq"] : 0;
          if (session === null || seq <= 0) {
            reply({ error: "nothing to regenerate" });
            return;
          }
          const current = session;
          let text = "";
          let fromSession: string | undefined;
          for (const event of current.store.read(current.identity.chainId, 1, 100_000)) {
            if (event.seq > seq) break;
            if (event.type !== "message") continue;
            const payload = event.data as { text?: unknown; session?: unknown };
            if (typeof payload.text === "string" && payload.text.trim().length > 0) {
              text = payload.text;
              if (typeof payload.session === "string") fromSession = payload.session;
            }
          }
          if (text.length === 0) {
            reply({ error: "no message before that answer" });
            return;
          }
          const marked = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "checkpoint",
            data: { label: "regenerate", ...(fromSession !== undefined ? { session: fromSession } : {}) },
          });
          control?.broadcast({ t: "append", event: marked });
          reply({ ok: true });
          void runMessage(text, fromSession);
          return;
        }
        if (kind === "cancel_turn") {
          if (activeTurn === null) {
            reply({ ok: false, error: "no turn is running" });
            return;
          }
          activeTurn.abort();
          activeTurn = null;
          reply({ ok: true });
          return;
        }
        if (kind === "skills_list") {
          const all = await skills.list();
          reply({
            skills: all.map((skill) => ({
              name: skill.name,
              description: skill.description,
              files: skill.files.length,
            })),
            root: join(paths.home, "skills"),
          });
          return;
        }
        if (kind === "tools_list") {
          reply({
            tools: toolsForTurn().map((tool) => ({ name: tool.name, description: tool.description })),
          });
          return;
        }
        if (kind === "mcp_list") {
          // The file is what travels; nothing starts servers from it
          // yet, and the screen says so instead of implying it does.
          const file = join(paths.home, "mcp.json");
          let text = "";
          try {
            text = await readFileAsync(file, "utf8");
          } catch {
            text = "{\n  \"servers\": {}\n}\n";
          }
          reply({ path: file, text, started: false });
          return;
        }
        if (kind === "mcp_save") {
          const text = typeof data["text"] === "string" ? data["text"] : "";
          const parsed: unknown = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })();
          if (typeof parsed !== "object" || parsed === null) {
            reply({ error: "that is not valid JSON" });
            return;
          }
          await writeFileAsync(join(paths.home, "mcp.json"), `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true });
          return;
        }
        if (kind === "providers_list") {
          const file = await loadProviders(paths);
          const catalog = await loadCatalog();
          reply({
            presets: presetsFromCatalog(catalog),
            source: catalogSource(catalog),
            active: file.active,
            accounts: file.accounts.map((account) => ({
              id: account.id,
              label: account.label,
              baseUrl: account.baseUrl,
              keySet: account.apiKey.length > 0,
              preset: account.preset ?? null,
            })),
          });
          return;
        }
        if (kind === "tools_state") {
          // The per-tool screen: everything the model could reach, what the
          // chain says about it, and which MCP servers are live right now.
          const current = session;
          const events = current === null ? [] : current.store.read(current.identity.chainId, 1, 100_000);
          const rules = toolRulesFromEvents(events);
          const approvedList = [...approvedToolsFromEvents(events)];
          const names = [...tools.map((tool) => tool.name), ...mcp.tools().map((tool) => tool.name)];
          const configured = mcpServersFromEvents(events);
          const live = new Set(mcp.serverLabels().map((entry) => entry.id));
          const liveTools = new Map(mcp.serverLabels().flatMap((entry) => entry.tools.map((name) => [name, entry.label] as const)));
          reply({
            ok: true,
            tools: [...new Set(names)].map((name) => {
              const rule = rules.get(name) ?? { enabled: true, ask: false };
              return {
                name,
                source: liveTools.get(name) !== undefined ? `mcp: ${String(liveTools.get(name))}` : "built-in",
                enabled: rule.enabled,
                ask: rule.ask,
                approved: approvedList.includes(name),
              };
            }),
            servers: configured.map((server) => ({
              id: server.id,
              label: server.label,
              transport: server.transport,
              ...(server.url !== undefined ? { url: server.url } : {}),
              ...(server.command !== undefined ? { command: server.command } : {}),
              enabled: server.enabled,
              live: live.has(server.id) && server.enabled,
            })),
          });
          return;
        }
        if (kind === "mcp_server_save") {
          // An MCP server is chain config: the event travels, every instance
          // folds the same fleet. The id is the app's address for it.
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain to configure MCP servers on yet" });
            return;
          }
          const id = typeof data["id"] === "string" && data["id"].trim().length > 0 ? data["id"].trim() : null;
          const label = typeof data["label"] === "string" && data["label"].trim().length > 0 ? data["label"].trim() : id;
          const transport = data["transport"] === "stdio" ? "stdio" : "http";
          const url = typeof data["url"] === "string" && data["url"].length > 0 ? data["url"] : undefined;
          const command = typeof data["command"] === "string" && data["command"].length > 0 ? data["command"] : undefined;
          if (id === null || (transport === "http" && url === undefined) || (transport === "stdio" && command === undefined)) {
            reply({ ok: false, error: "an id and an url or command are required" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "mcp_server",
            data: {
              id,
              label,
              transport,
              ...(url !== undefined ? { url } : {}),
              ...(command !== undefined ? { command } : {}),
              enabled: data["enabled"] !== false,
            },
          });
          control?.broadcast({ t: "append", event });
          void mcp.sync(mcpServersFromEvents(current.store.read(current.identity.chainId, 1, 100_000)));
          reply({ ok: true, id });
          return;
        }
        if (kind === "mcp_server_delete") {
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain to configure MCP servers on yet" });
            return;
          }
          const id = typeof data["id"] === "string" && data["id"].trim().length > 0 ? data["id"].trim() : null;
          if (id === null) {
            reply({ ok: false, error: "an id is required" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "mcp_server",
            data: { id, removed: true },
          });
          control?.broadcast({ t: "append", event });
          void mcp.sync(mcpServersFromEvents(current.store.read(current.identity.chainId, 1, 100_000)));
          reply({ ok: true, id });
          return;
        }
        if (kind === "tool_rule") {
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain for tool rules yet" });
            return;
          }
          const tool = typeof data["tool"] === "string" && data["tool"].trim().length > 0 ? data["tool"].trim() : null;
          if (tool === null) {
            reply({ ok: false, error: "a tool name is required" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "tool_rule",
            data: {
              tool,
              ...(typeof data["enabled"] === "boolean" ? { enabled: data["enabled"] } : {}),
              ...(typeof data["ask"] === "boolean" ? { ask: data["ask"] } : {}),
            },
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true, tool });
          return;
        }
        if (kind === "tool_approve") {
          // The answer to an approval_request: allow learns for next time,
          // deny answers this call only.
          const req = typeof data["req"] === "string" && data["req"].length > 0 ? data["req"] : null;
          if (req === null) {
            reply({ ok: false, error: "a req is required" });
            return;
          }
          const allow = data["allow"] !== false;
          const answered = answerApproval(req, allow);
          if (answered === null) {
            reply({ ok: false, error: "no pending approval for that req" });
            return;
          }
          const tool = answered.tool;
          // A yes to one dangerous call is not a yes to the tool from now on.
          const learned = allow && answered.learn;
          if (session !== null) {
            const current = session;
            // Every answer is recorded so the card closes on every device. Only
            // "allow" is learned by the fold; "once" and "deny" answer this call.
            const event = current.store.append(current.identity.chainId, {
              id: uuid(),
              node: current.identity.nodeId,
              type: "tool_approval",
              data: { tool, req, decision: learned ? "allow" : allow ? "once" : "deny" },
            });
            control?.broadcast({ t: "append", event });
          }
          reply({ ok: true, tool, learned });
          return;
        }
        if (kind === "tool_approval_reset") {
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain for approvals yet" });
            return;
          }
          const tool = typeof data["tool"] === "string" && data["tool"].trim().length > 0 ? data["tool"].trim() : null;
          if (tool === null) {
            reply({ ok: false, error: "a tool name is required" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "tool_approval",
            data: { tool, decision: "reset" },
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true, tool });
          return;
        }
        if (kind === "provider_save") {
          // A preset, or anything with a URL. Several customs can exist at once;
          // the id is what the rest of the app addresses.
          const label = typeof data["label"] === "string" ? data["label"].trim() : "";
          const baseUrl = typeof data["baseUrl"] === "string" ? data["baseUrl"].trim() : "";
          const apiKey = typeof data["apiKey"] === "string" ? data["apiKey"] : "";
          const preset = typeof data["preset"] === "string" ? data["preset"] : undefined;
          const wanted = typeof data["id"] === "string" ? data["id"] : "";
          if (baseUrl.length === 0 || label.length === 0) {
            reply({ error: "a provider needs a name and a URL" });
            return;
          }
          if (!/^https?:\/\//.test(baseUrl)) {
            reply({ error: "the URL has to start with http:// or https://" });
            return;
          }
          const file = await loadProviders(paths);
          const id = wanted.length > 0 ? wanted : `prov-${String(Date.now())}`;
          const existing = file.accounts.find((account) => account.id === id);
          const account: ProviderAccount = {
            id,
            label,
            baseUrl,
            apiKey: apiKey.length > 0 ? apiKey : (existing?.apiKey ?? ""),
            ...(preset !== undefined ? { preset } : {}),
          };
          await saveProviders(paths, upsertAccount(file, account));
          control?.sendState();
          reply({ ok: true, id, keySet: account.apiKey.length > 0 });
          return;
        }
        if (kind === "take_shared") {
          // The Android share sheet parks its text in a one-slot inbox next
          // to the home; one read clears it, so the same text never lands twice.
          const inbox = join(dirname(paths.home), "shared-inbox.txt");
          try {
            const shared = await readFileAsync(inbox, "utf8");
            await rm(inbox, { force: true });
            reply({ ok: true, text: shared.slice(0, 20_000) });
          } catch {
            reply({ ok: true, text: "" });
          }
          return;
        }
        if (kind === "export") {
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain to export yet" });
            return;
          }
          const what = typeof data["what"] === "string" ? data["what"] : "";
          const exports = join(paths.home, "exports");
          await mkdir(exports, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const allEvents = current.store.read(current.identity.chainId, 1, 100_000);
          if (what === "chain") {
            const path = join(exports, `chain-${stamp}.jsonl`);
            const result = exportChain(current.store, current.identity.chainId, path);
            // The download window, when the owner opened it: a second copy in
            // the Android download map, where a phone can share it.
            const window = join(dirname(paths.home), "downloads");
            let shared: string | null = null;
            if (existsSync(window)) {
              try {
                shared = join(window, `roan-chain-${stamp}.jsonl`);
                await copyFile(path, shared);
              } catch {
                shared = null;
              }
            }
            reply({ ok: true, path, shared, count: result.count });
            return;
          }
          const known = readSessions(allEvents).all.some((entry) => entry.id === what);
          if (!known) {
            reply({ ok: false, error: "unknown conversation" });
            return;
          }
          const markdown = sessionMarkdown(allEvents, what);
          // The shareable copy: one self-contained file, no scripts, no external requests.
          const html = renderConversationHtml(allEvents, what, { now: Date.now() });
          const attachments = sessionAttachments(allEvents, what);
          const window = join(dirname(paths.home), "downloads");
          let shared: string | null = null;
          if (attachments.length > 0) {
            // A conversation with photos becomes a folder: the story in
            // conversation.md, the photos beside it in attachments/.
            const folder = join(exports, `conversation-${stamp}`);
            await mkdir(join(folder, "attachments"), { recursive: true });
            const path = join(folder, "conversation.md");
            await writeFileAsync(path, markdown, "utf8");
            await writeFileAsync(join(folder, "conversation.html"), html, "utf8");
            for (const file of attachments) {
              await writeFileAsync(join(folder, "attachments", file.file), Buffer.from(file.data, "base64"));
            }
            if (existsSync(window)) {
              try {
                shared = join(window, `roan-conversation-${stamp}`);
                await cp(folder, shared, { recursive: true });
              } catch {
                shared = null;
              }
            }
            reply({ ok: true, path, shared, count: attachments.length });
            return;
          }
          const path = join(exports, `conversation-${stamp}.md`);
          await writeFileAsync(path, markdown, "utf8");
          const htmlPath = join(exports, `conversation-${stamp}.html`);
          await writeFileAsync(htmlPath, html, "utf8");
          if (existsSync(window)) {
            try {
              shared = join(window, `roan-conversation-${stamp}.md`);
              await copyFile(path, shared);
            } catch {
              shared = null;
            }
          }
          reply({ ok: true, path, html: htmlPath, shared, count: 1 });
          return;
        }
        if (kind === "storage_window") {
          // The Termux pattern: symlinks next to the home, pointing at the
          // public storages. The daemon lives in the app, so the base is the
          // app's own files dir — on Android. Elsewhere the probe refuses
          // honestly instead of inventing a window.
          const result = await openStorageWindow({
            base: dirname(paths.home),
            targets: ANDROID_STORAGE_TARGETS,
            canWriteShared: sharedStorageProbe("/storage/emulated/0"),
          });
          reply({ ok: result.refused === null, ...result });
          return;
        }
        if (kind === "provider_remove") {
          const id = typeof data["id"] === "string" ? data["id"] : "";
          const file = await loadProviders(paths);
          await saveProviders(paths, {
            accounts: file.accounts.filter((account) => account.id !== id),
            active: file.active === id ? null : file.active,
          });
          reply({ ok: true });
          return;
        }
        if (kind === "provider_pick") {
          const id = typeof data["id"] === "string" ? data["id"] : "";
          const model = typeof data["model"] === "string" ? data["model"] : "";
          const file = await loadProviders(paths);
          const account = file.accounts.find((item) => item.id === id);
          if (account === undefined) {
            reply({ error: "unknown provider" });
            return;
          }
          await saveProviders(paths, { accounts: file.accounts, active: id });
          await saveSettings(paths, {
            provider: account.id,
            baseUrl: account.baseUrl,
            ...(account.apiKey.length > 0 ? { apiKey: account.apiKey } : {}),
            ...(model.length > 0 ? { model } : {}),
          });
          settings = await loadSettings(paths);
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          // The model pill on every connected screen follows the state, so a
          // pick must be announced, not only stored.
          control?.sendState();
          reply({ ok: true, provider: account.id, model: settings.model });
          return;
        }
        if (kind === "models_list") {
          const id = typeof data["id"] === "string" ? data["id"] : "";
          const file = await loadProviders(paths);
          const account = file.accounts.find((item) => item.id === id);
          if (account === undefined) {
            reply({ error: "unknown provider" });
            return;
          }
          const live = await fetchModels(account);
          reply({ models: live.models, ...(live.error !== undefined ? { error: live.error } : {}) });
          return;
        }
        if (kind === "models_search") {
          // models.dev is the registry; the bundled snapshot only covers an
          // offline machine.
          const catalog = await loadCatalog();
          const query = (typeof data["query"] === "string" ? data["query"] : "").toLowerCase();
          const out: { provider: string; providerName: string; model: string; modelName: string; context?: number }[] = [];
          for (const provider of Object.values(catalog.providers)) {
            for (const model of Object.values(provider.models)) {
              const hay = `${provider.name} ${model.id} ${model.name}`.toLowerCase();
              if (query.length > 0 && !hay.includes(query)) continue;
              out.push({
                provider: provider.id,
                providerName: provider.name,
                model: model.id,
                modelName: model.name,
                ...(model.context !== undefined ? { context: model.context } : {}),
              });
              if (out.length >= 200) break;
            }
            if (out.length >= 200) break;
          }
          reply({ models: out, total: Object.keys(catalog.providers).length, source: catalogSource(catalog) });
          return;
        }
        if (kind === "settings_save") {
          // The key, the base URL and the model, from the app. This is how a
          // device that created its own chain becomes able to answer at all,
          // and how a key reaches the other machines: the saved file is part of
          // the env, so publishing it puts it in the chain.
          const patch: Record<string, string> = {};
          for (const field of ["apiKey", "baseUrl", "model", "provider"] as const) {
            if (typeof data[field] === "string") patch[field] = data[field] as string;
          }
          if (Object.keys(patch).length === 0) {
            reply({ error: "nothing to save" });
            return;
          }
          await saveSettings(paths, patch);
          settings = await loadSettings(paths);
          // Turning the setting on or off takes effect for the next tool call.
          setFullDiskAccess(settings.access.fullDisk);
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          // Never echo the value: a key in a reply is a key in a log.
          reply({ ok: true, model: settings.model, provider: settings.provider, keySet: settings.apiKey.length > 0 });
          return;
        }
        if (kind === "model_set") {
          const provider = typeof data["provider"] === "string" ? data["provider"] : "";
          const model = typeof data["model"] === "string" ? data["model"] : "";
          const entry = (await loadCatalog()).providers[provider];
          if (entry === undefined || model.length === 0) {
            reply({ error: "onbekende provider" });
            return;
          }
          const saved = await saveSettings(paths, { model, baseUrl: entry.api });
          // Picking a model in the app has to take effect in this process; the
          // settings were read once at boot.
          settings = await loadSettings(paths);
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true, model: saved.model, baseUrl: saved.baseUrl });
          return;
        }
        if (kind === "checkpoints_list") {
          const list: { seq: number; label: string; ts: number; session?: string }[] = [];
          if (session !== null) {
            for (const event of session.store.read(session.identity.chainId, 1, 100_000)) {
              if (event.type !== "checkpoint") continue;
              const payload = event.data as { label?: unknown; session?: unknown };
              list.push({
                seq: event.seq,
                label: typeof payload.label === "string" ? payload.label : "checkpoint",
                ts: event.ts,
                ...(typeof payload.session === "string" ? { session: payload.session } : {}),
              });
            }
          }
          reply({ checkpoints: list.reverse() });
          return;
        }
        if (kind === "import_discover" || kind === "import_plan") {
          const current = session;
          if (current === null) {
            reply({ ok: false, error: "no chain" });
            return;
          }
          const candidates = Array.isArray(data["candidates"])
            ? (data["candidates"] as unknown[]).filter((entry): entry is string => typeof entry === "string")
            : [];
          const found = await discoverInstructionFiles(candidates);
          if (kind === "import_discover") {
            reply({ ok: true, files: found });
            return;
          }
          const entries = await toSnapshotEntries(found);
          const existing = await collectEnvEntries({ home: paths.home });
          const plan = planImport(existing.map((entry: { path: string }) => entry.path), entries);
          reply({ ok: true, plan });
          return;
        }
        if (kind === "steer") {
          if (activeSteer === null) {
            reply({ ok: false, error: "no turn is running" });
            return;
          }
          const text = typeof data["text"] === "string" ? data["text"] : "";
          reply({ ok: true, ...activeSteer.push(text) });
          return;
        }
        if (kind === "session_archive" || kind === "session_delete") {
          const current = session;
          const wanted = typeof data["id"] === "string" ? data["id"] : "";
          if (current === null || wanted.length === 0) {
            reply({ ok: false, error: "no chain or session id" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "session",
            data: kind === "session_delete" ? { id: wanted, deleted: true } : { id: wanted, archived: data["archived"] !== false },
          });
          control?.broadcast({ t: "append", event });
          control?.sendState();
          reply({ ok: true });
          return;
        }
        if (kind === "jobs_list" || kind === "job_stop") {
          // The background jobs of this device, for the screen that shows them.
          if (kind === "job_stop") {
            const id = typeof data["id"] === "number" ? data["id"] : Number.NaN;
            if (!Number.isInteger(id)) {
              reply({ ok: false, error: "job_stop needs the number of a job" });
              return;
            }
            processes.stop(id);
          }
          reply({
            ok: true,
            jobs: processes.list().map((job) => ({
              id: job.id,
              command: job.command,
              status: job.status,
              exitCode: job.exitCode,
              output: job.output.slice(-4000),
            })),
          });
          return;
        }
        if (kind === "auxiliary") {
          // A model of its own for one job (vision, background). Without a
          // slot it is a question; an empty model hands the job back to the
          // main model.
          if (data["slot"] === undefined) {
            reply({ ok: true, auxiliary: settings.auxiliary });
            return;
          }
          if (!isAuxSlot(data["slot"]) || typeof data["model"] !== "string") {
            reply({ ok: false, error: "auxiliary needs a slot (vision, background or mini) and a model" });
            return;
          }
          const provider = typeof data["provider"] === "string" ? data["provider"] : "";
          settings = await saveSettings(paths, {
            auxiliary: withAuxModel(settings.auxiliary, data["slot"], data["model"], provider),
          });
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true, auxiliary: settings.auxiliary });
          return;
        }
        if (kind === "fallback_model") {
          // The model a turn retries on when the first one fails. Without a
          // value it is a question; an empty string turns it off.
          if (data["model"] === undefined) {
            reply({ ok: true, model: settings.fallbackModel });
            return;
          }
          if (typeof data["model"] !== "string") {
            reply({ ok: false, error: "model must be a model id, or empty to turn the fallback off" });
            return;
          }
          settings = await saveSettings(paths, { fallbackModel: data["model"] });
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true, model: settings.fallbackModel });
          return;
        }
        if (kind === "access") {
          // Who may reach the UI and the control socket of this device. Without
          // a value it is a question; with one it is saved and applies to the
          // next connection (the gate reads the setting each time).
          if (data["deviceOnly"] === undefined) {
            reply({ ok: true, deviceOnly: deviceAccess.deviceOnly });
            return;
          }
          if (typeof data["deviceOnly"] !== "boolean") {
            reply({ ok: false, error: "deviceOnly must be true or false" });
            return;
          }
          // Per machine on purpose: it is this device's own listener, so it
          // is kept in state/ and never published with the env.
          deviceAccess = await saveDeviceAccess(paths.state, { deviceOnly: data["deviceOnly"] });
          log(`access: ${deviceAccess.deviceOnly ? "this device only" : "this device and the tailnet"}`);
          reply({ ok: true, deviceOnly: deviceAccess.deviceOnly });
          return;
        }
        if (kind === "skill_approve" || kind === "skill_reject") {
          // The owner's answer to a skill the agent proposed. A yes writes the
          // skill to this device; the env loop carries it to the others.
          const current = session;
          const id = typeof data["id"] === "string" ? data["id"].trim() : "";
          if (current === null || id.length === 0) {
            reply({ ok: false, error: "no chain, or no proposal id" });
            return;
          }
          const events = current.store.read(current.identity.chainId, 1, 100_000);
          const proposal = foldSkillProposals(events).find((entry) => entry.id === id);
          if (proposal === undefined || proposal.status !== "pending") {
            reply({ ok: false, error: "that proposal is not waiting for an answer" });
            return;
          }
          const approve = kind === "skill_approve";
          if (approve) {
            await installSkill(paths.home, {
              name: proposal.name,
              description: proposal.description,
              body: proposal.body,
            });
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: SKILL_PROPOSAL_EVENT,
            data: approve
              ? { kind: SKILL_APPROVAL_KIND, id, status: "approved" }
              : { kind: SKILL_REJECTION_KIND, id },
          });
          control?.broadcast({ t: "append", event });
          if (approve) {
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true, name: proposal.name, saved: approve });
          return;
        }
        if (kind === "command_save" || kind === "command_remove") {
          // The owner's own slash commands are chain events, so a command
          // saved on one device works on all of them.
          const current = session;
          const raw = typeof data["name"] === "string" ? data["name"].trim().replace(/^\//, "") : "";
          const name = parseCommandLine(`/${raw}`)?.name === raw ? raw : null;
          const prompt = typeof data["prompt"] === "string" ? data["prompt"].trim() : "";
          if (current === null || name === null) {
            reply({ ok: false, error: "no chain, or not a usable command name" });
            return;
          }
          if (kind === "command_save" && prompt.length === 0) {
            reply({ ok: false, error: "a command needs a prompt" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "command",
            data: kind === "command_save" ? { name, prompt } : { name, removed: true },
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true, name });
          return;
        }
        if (kind === "goal") {
          const current = session;
          const text = typeof data["text"] === "string" ? data["text"].trim() : "";
          if (current === null || text.length === 0) {
            reply({ ok: false, error: "no chain or empty goal text" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "goal",
            data: { id: uuid(), text, status: "open", createdAt: Date.now() },
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true });
          return;
        }
        if (kind === "goal_update") {
          const current = session;
          const goal = typeof data["id"] === "string" ? data["id"] : "";
          const status = data["status"] === "done" || data["status"] === "cancelled" || data["status"] === "open" ? data["status"] : null;
          if (current === null || goal.length === 0 || status === null) {
            reply({ ok: false, error: "goal_update needs an id and a valid status" });
            return;
          }
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: "goal_update",
            data: { goal, status, ...(typeof data["note"] === "string" ? { note: data["note"] } : {}) },
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true });
          return;
        }
        if (kind === "effort") {
          // A preference, not chain state: it appends nothing and only changes
          // how the next turn is asked. Invalid values are rejected here so a
          // typo never becomes a request field.
          // Without a level it is a question: the picker asks what is set.
          if (data["effort"] === undefined) {
            reply({ ok: true, effort: settings.effort });
            return;
          }
          const requested = typeof data["effort"] === "string" ? data["effort"] : "";
          if (!isEffortLevel(requested)) {
            reply({ ok: false, error: "effort must be low, normal or high" });
            return;
          }
          settings = await saveSettings(paths, { effort: requested });
          // The config travels: the level is part of how the agent behaves, so
          // the other devices should run their turns the same way. The file is
          // what publishes it — an `effort` event would be chain state, and
          // this is not.
          if (session !== null) {
            const current = session;
            void publishEnv({
              store: current.store,
              chain: current.identity.chainId,
              node: current.identity.nodeId,
              home: paths.home,
            }).catch(() => undefined);
          }
          reply({ ok: true, effort: settings.effort });
          return;
        }
        if (kind === "plan_mode") {
          const current = session;
          const wanted = typeof data["session"] === "string" && data["session"].length > 0 ? data["session"] : resolveSession();
          if (current === null || wanted === null) {
            reply({ ok: false, error: "no chain or session for plan mode" });
            return;
          }
          const payload = data["approve"] === true ? approvePlan(wanted) : planModeEvent(wanted, data["enabled"] === true);
          const event = current.store.append(current.identity.chainId, {
            id: uuid(),
            node: current.identity.nodeId,
            type: payload.type,
            data: payload.data,
          });
          control?.broadcast({ t: "append", event });
          reply({ ok: true, session: wanted, enabled: payload.data.enabled });
          return;
        }
        reply({ error: "unknown request: " + kind });
      } catch (error) {
        reply({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    onCheckpoint: (label?: string) => {
      if (session === null) return;
      const current = session;
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "checkpoint",
        data: { label: label ?? "checkpoint", session: resolveSession() },
      });
      log("checkpoint: " + (label ?? "checkpoint"));
    },
    onRewind: (seq: number) => {
      const active = resolveSession();
      if (active === null) return;
      // Rewinding never deletes: it opens a new conversation that starts from
      // that point, so the old one stays readable.
      startSession(`Rewind to #${String(seq)}`, { session: active, seq });
      log("rewind: new session from " + String(seq));
    },
    onRenameNode: (wanted: string, name: string) => {
      if (session === null) return;
      const current = session;
      const roster = readNodes(current.store.read(current.identity.chainId, 1, 100_000));
      const known = roster.find((entry) => entry.node === wanted);
      if (known === undefined) return;
      // The same shape as an announcement, only the name is new: the fold
      // takes the newest fact per node, so the rename rides the chain and
      // every device shows the same roster.
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "node",
        data: { node: known.node, name, host: known.host, port: known.port },
      });
      control?.sendState();
    },
    onLeaveChain: () => {
      if (session === null) return;
      try {
        const archive = leaveChain(paths);
        log("chain: left — identity and history archived at " + archive + "; restart into onboarding");
      } catch (error) {
        log("chain: leave refused — " + String(error));
        return;
      }
      // The identity is gone; this process is a daemon for a chain it no
      // longer has. The supervisor (systemd, the app shell) restarts it into
      // onboarding, where a new chain can be created or a code joined.
      setTimeout(() => void stopDaemon("left the chain"), 250);
    },
    onRenameSession: (wanted: string, title: string) => {
      if (session === null) return;
      const current = session;
      const index = readSessions(current.store.read(current.identity.chainId, 1, 100_000));
      if (!index.all.some((entry) => entry.id === wanted)) return;
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "session_title",
        data: { session: wanted, title },
      });
      control?.sendState();
    },
    onRemoveNode: (wanted: string) => {
      if (session === null) {
        return { ok: false as const, message: "this device is not in a chain yet" };
      }
      const current = session;
      const removed = removeNode(
        current.store,
        current.identity.chainId,
        current.identity.nodeId,
        wanted,
      );
      if (!removed.ok) return removed;
      if (removed.event !== null) {
        // Membership is a chain fact like any other: the event travels to every
        // device, and the fold is what decides who is still here.
        control?.broadcast({ t: "append", event: removed.event });
        control?.sendState();
        log("node: removed " + (removed.name ?? removed.node) + " (" + removed.node + ")");
      }
      return { ok: true as const };
    },
    onNewSession: (title?: string) => {
      const id = openNewSession(title);
      return id;
    },
    onCreate,
    onJoin,
    log: (message) => log(message),
  });

  // The port exists now, so peers can be mounted on it and the app's own
  // windows have somewhere to connect.
  if (session !== null) await startReplication();

  const st = state();
  log(
    st.onboarding
      ? "roan daemon: waiting for a chain (port " + String(control.port) + ", " + control.url + ")"
      : "roan daemon: chain " +
          String(st.chain) +
          ", node " +
          String(st.node) +
          ", port " +
          String(control.port) +
          " (" +
          control.url +
          ")",
  );
}

const shutdown = (): void => {
  stopDiscovery?.();
  stopDiscovery = null;
  void stopPeers()
    .catch(() => undefined)
    .finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err: unknown) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
