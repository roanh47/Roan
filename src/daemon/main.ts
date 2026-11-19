import { randomUUID } from "node:crypto";
import { EventStore } from "../chain/store.js";
import type { ChainResponse, DaemonState } from "./control-protocol.js";
import { decodeJoinCode, encodeJoinCode } from "./control-protocol.js";
import { createIdentity, loadIdentity, type Identity } from "./identity.js";
import { ensurePaths, migrateLegacyHome, resolvePaths, type RoanPaths } from "./paths.js";
import { advertiseHost, advertiseHosts, bindListenHost, resolvePeerBind, type PeerBind } from "./advertise.js";
import { loadSettings } from "./settings.js";
import { startControlServer } from "./control.js";
import { ChainNodeStore } from "./peer-store.js";
import { addPeer, peers as peerList, startPeers, stopPeers } from "./peers.js";
import { probe, startDiscovery, tailscaleHosts } from "./discovery.js";
import { findNode, readNodes } from "../chain/nodes.js";
import os from "node:os";
import { createHash } from "node:crypto";
import type { Logger } from "../sync/types.js";
import { runTurn } from "./turn-runner.js";
import { builtinTools } from "../tools.js";
import { contextTools } from "../tools/context-tools.js";
import { MemoryStore } from "../context/memory.js";
import { SkillLibrary } from "../context/skills.js";
import { buildSystemPrompt } from "../context/prompt.js";
import { adoptEnv, adoptEnvEvent, latestEnv, publishEnv } from "./env-sync.js";
import { dirname, join, resolve } from "node:path";
import { createRunOnNodeTool, serveDelegation, type RelayOptions } from "./relay.js";
import { readSessions } from "../chain/sessions.js";
import { diffWorkspace, hashContent, scanWorkspace, type FileEntry } from "../workspace/scan.js";
import { applyWorkspaceEvent } from "../workspace/sync.js";
import { randomUUID as uuid } from "node:crypto";
import { mkdir, readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { runHooks, type HookConfig } from "../hooks/run.js";
import { dueJobs, loadCron } from "../cron/jobs.js";
import { engineAvailable, runHermesTurn } from "../engine/hermes.js";
import { catalogSource, loadCatalog } from "../providers/live.js";
import { presetsFromCatalog, fetchModels, loadProviders, saveProviders, upsertAccount, type ProviderAccount } from "./providers.js";
import { saveSettings } from "./settings-write.js";

const CONTROL_PORT = Number(process.env["ROAN_CONTROL_PORT"] ?? 7411);
const PEER_PORT = Number(process.env["ROAN_PEER_PORT"] ?? 7412);

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
 * Waar de peer-link luistert. Standaard alléén het tailscale-adres: de
 * handshake weigert nog steeds elke peer met een verkeerd token of een
 * andere keten, maar de deur hoeft niet op élk netwerk open te staan.
 * `ROAN_PEER_BIND=lan` of een adres zet dat bewust om.
 */
function peerBind(paths: RoanPaths): PeerBind {
  return resolvePeerBind(os.networkInterfaces());
}

/**
 * Elk adres waarop een ander toestel dit toestel kan bellen, best eerst —
 * en nooit meer dan de bind blootstelt. De joiner belt ze allemaal tot er
 * één opengaat: de manier boekt niet, ze moeten elkaar vinden.
 */
function dialHosts(paths: RoanPaths): string[] {
  return advertiseHosts(peerBind(paths), os.networkInterfaces());
}

/** Discovery hoort bij het proces, niet bij een sessie: bij afsluiten moet hij stoppen. */
let stopDiscovery: (() => void) | null = null;

const peerLogger: Logger = {
  debug: () => undefined,
  info: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
  warn: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
  error: (message, meta) => log("peer: " + message + (meta === undefined ? "" : " " + JSON.stringify(meta))),
};

function log(message: string): void {
  process.stderr.write(message + "\n");
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
  if (migration === "moved") log("home: moved the old ~/.roan to ~/.Roan once");
  else if (migration === "both") log("home: ~/.Roan exists and an old ~/.roan is still there; leaving it alone");
  await ensurePaths(paths);
  // Reassigned when a snapshot from the chain lands: the key and the model
  // travel in `config.json`, so a device that joins mid-run has to pick them up
  // without a restart.
  let settings = await loadSettings(paths);
  // A packaged app on a machine without the hermes binary must still answer:
  // erroring on every turn would make it a dead window. The in-process loop is
  // the fallback, and the log says which one is running.
  if (settings.engine === "hermes" && !(await engineAvailable().catch(() => false))) {
    settings = { ...settings, engine: "builtin" };
    log("engine: no hermes binary on this machine, using the builtin loop");
  }

  // Everything this device knows before the first token: its own memory files
  // and the skills on its own disk. Both are copies, never a fetch from a peer.
  const memory = new MemoryStore(paths.home);
  const skills = new SkillLibrary(join(paths.home, "skills"));
  const tools = [...builtinTools, ...contextTools(memory, skills)];
  const agentContext: AgentContext = {
    memory,
    skills,
    tools,
    prompt: async () =>
      buildSystemPrompt({
        base: SYSTEM_PROMPT,
        user: await memory.render("user"),
        memory: await memory.render("memory"),
        skills: await skills.index(),
      }),
  };

  let session: Session | null = null;
  const identity = await loadIdentity(paths);
  if (identity) session = { identity, store: EventStore.open(paths.database) };

  const state = (): DaemonState => ({
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
          })),
    activeSession:
      session === null
        ? null
        : (readSessions(session.store.read(session.identity.chainId, 1, 10_000)).active?.id ?? null),
    chain: session?.identity.chainId ?? null,
    node: session?.identity.nodeId ?? null,
    head: session ? session.store.head(session.identity.chainId) : 0,
    peers: peerList(),
    invite:
      session === null
        ? null
        : encodeJoinCode({
            v: 2,
            chain: session.identity.chainId,
            token: session.identity.token,
            hosts: dialHosts(paths),
            port: PEER_PORT,
          }),
  });

  let control: Awaited<ReturnType<typeof startControlServer>> | null = null;
  /** The turn in flight, so "stop" has something to abort. */
  let activeTurn: AbortController | null = null;
  let replicating = false;

  /**
   * Opens the peer link for the chain in `session`. Runs once per process: the
   * replication layer keeps a single listener, and starting it twice would mean
   * two servers on the same port.
   */
  const startReplication = async (): Promise<void> => {
    if (session === null || replicating) return;
    const node = new ChainNodeStore(session.store, session.identity.nodeId, session.identity.chainId);
    // A tool request that another device addressed to us arrives as a replicated
    // event; it is carried out here, on this machine, and answered in the chain.
    node.watchApplied((event) => {
      // Everything a peer appends is as real here as on the device that wrote
      // it: the app windows on this machine see the message live, and session
      // metadata (a new conversation, a rename) also refreshes the drawer.
      const chainEvent = event as unknown as import("../protocol/types.js").Event;
      control?.broadcast({ t: "append", event: chainEvent });
      if (chainEvent.type === "session" || chainEvent.type === "session_title") control?.sendState();
      if (event.type === "workspace") {
        void applyWorkspaceEvent(paths.syncedWorkspace, event as never)
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
    const bind = peerBind(paths);
    await startPeers({
      store: node,
      token: session.identity.token,
      host: bindListenHost(bind),
      port: PEER_PORT,
      logger: peerLogger,
      onError: (error) => log("peer error: " + error.message),
    });
    replicating = true;
    log("peer: listening on " + bindListenHost(bind) + ":" + String(PEER_PORT) + " (" + bind.kind + ")");
    // Elke machine zoekt de andere via Tailscale. Zo hoeft niemand een code te
    // plakken en komt de kluwen ook na een herstart of een nieuw IP terug.
    if (process.env["ROAN_DISCOVERY"] !== "off" && stopDiscovery === null) {
      stopDiscovery = startDiscovery({
        port: PEER_PORT,
        logger: peerLogger,
        onCandidate: (host) => {
          try {
            addPeer(`${host}:${String(PEER_PORT)}`);
          } catch (error: unknown) {
            log("discovery: kon peer niet toevoegen: " + String(error));
          }
        },
      });
    }
  };

  if (session !== null) await startReplication();

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
    let host = advertiseHost(peerBind(paths), os.networkInterfaces());
    if (host.length === 0) {
      const found = await tailscaleHosts().catch(() => ({ self: null, hosts: [] as string[] }));
      host = found.self ?? "";
    }
    const data = { node: current.identity.nodeId, name: os.hostname(), host, port: PEER_PORT };
    const id = `node-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
    if (current.store.read(chain, 1, 100_000).some((event) => event.id === id)) return;
    const event = current.store.append(chain, { id, node: current.identity.nodeId, type: "node", data });
    control?.broadcast({ t: "append", event });
    log(`node: announced ${data.name}${host.length > 0 ? " at " + host : " without an address"}`);
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

  const publishWorkspace = async (): Promise<void> => {
    if (session === null) return;
    const current = session;
    const root = paths.syncedWorkspace;
    const scanned = await scanWorkspace(root);
    if (workspaceKnown === null) {
      workspaceKnown = scanned;
      return;
    }
    const before = workspaceKnown;
    const { puts, deletes } = diffWorkspace(before, scanned);
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
    workspaceKnown = scanned;
  };

  /** Replays every file event in the chain onto this disk, oldest first. */
  const applyChainWorkspace = async (root: string): Promise<void> => {
    if (session === null) return;
    const events = session.store.read(session.identity.chainId, 1, 100_000);
    for (const event of events) {
      if (event.type !== "workspace") continue;
      await applyWorkspaceEvent(root, event as never);
    }
  };

  /** What the chain already says each file is, so a first scan does not repeat it. */
  const chainWorkspaceIndex = (): Map<string, FileEntry> => {
    const index = new Map<string, FileEntry>();
    if (session === null) return index;
    for (const event of session.store.read(session.identity.chainId, 1, 100_000)) {
      if (event.type !== "workspace") continue;
      const data = event.data as { op?: unknown; path?: unknown; hash?: unknown };
      if (typeof data.path !== "string") continue;
      if (data.op === "delete") index.delete(data.path);
      else if (typeof data.hash === "string") index.set(data.path, { path: data.path, hash: data.hash, bytes: 0 });
    }
    return index;
  };

  const startWorkspaceLoop = async (): Promise<void> => {
    if (session === null) return;
    if (workspaceKnown === null) workspaceKnown = chainWorkspaceIndex();
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
   * The tools for one turn. `run_on_node` is bound to the live session, so it
   * is added per turn instead of once at boot.
   */
  const toolsForTurn = (): readonly import("../types.js").Tool[] => {
    const relayNow = relayOptions();
    if (relayNow === null) return tools;
    return [
      ...tools,
      createRunOnNodeTool(relayNow, () => {
        if (session === null) return [];
        const current = session;
        return readNodes(current.store.read(current.identity.chainId, 1, 100_000));
      }),
      {
        name: "delegate",
        description:
          "Hand a self-contained task to a fresh agent with its own context and get only the summary back. " +
          "Use it for work that would flood this conversation.",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "What the subagent must do, complete enough to stand alone" },
            cwd: { type: "string", description: "Folder to work in; the workspace by default" },
          },
          required: ["task"],
        },
        async run(args) {
          const task = String(args["task"] ?? "").trim();
          if (task.length === 0) throw new Error("task is required");
          const dir = typeof args["cwd"] === "string" ? args["cwd"] : paths.syncedWorkspace;
          const result = await runHermesTurn({
            prompt: `Je bent een subagent. Doe deze taak en antwoord met een korte samenvatting van wat je deed en vond, zonder de hele uitvoer te herhalen.\n\n${task}`,
            cwd: dir,
            timeoutMs: 900_000,
          });
          return result.text;
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
    if (wanted !== undefined && index.sessions.some((entry) => entry.id === wanted)) return wanted;
    const active = index.active;
    if (active !== null) return active.id;
    return null;
  };

  const startSession = (title?: string, branchOf?: { session: string; seq: number }): string | null => {
    if (session === null) return null;
    const current = session;
    const id = uuid();
    current.store.append(current.identity.chainId, {
      id: uuid(),
      node: current.identity.nodeId,
      type: "session",
      data: {
        id,
        title: title ?? `Conversation ${String(readSessions(current.store.read(current.identity.chainId, 1, 100_000)).sessions.length + 1)}`,
        ...(branchOf !== undefined ? { branchOf } : {}),
      },
    });
    return id;
  };

  const runMessage = async (text: string, wanted?: string, echoId?: string): Promise<void> => {
    if (!session) return;
    const current = session;
    const sessionId = resolveSession(wanted) ?? startSession(text.slice(0, 60));
    if (sessionId === null) return;
    const stored = current.store.append(current.identity.chainId, {
      // The app's own event id, when it sent one: its pending bubble clears
      // the moment this echo arrives, instead of a second copy appearing.
      id: echoId !== undefined && echoId.length > 0 ? echoId : uuid(),
      node: current.identity.nodeId,
      type: "message",
      data: { text, session: sessionId },
    });
    control?.broadcast({ t: "append", event: stored });
    const systemPrompt = await agentContext.prompt();
    const hooks = await loadHooks();
    const started = await runHooks(hooks, "turn_start", {
      cwd: paths.syncedWorkspace,
      extra: { ROAN_CHAIN: current.identity.chainId, ROAN_SESSION: sessionId },
    });
    for (const result of started) {
      if (result.exitCode !== 0) log(`hook turn_start failed (${String(result.exitCode)}): ${result.command}`);
    }
    const controller = new AbortController();
    activeTurn = controller;
    await runTurn(
      {
        signal: controller.signal,
        store: current.store,
        chain: current.identity.chainId,
        node: current.identity.nodeId,
        provider: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
        cwd: paths.syncedWorkspace,
        systemPrompt,
        tools: toolsForTurn(),
        engine: settings.engine,
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
      text,
    );
    activeTurn = null;
    const ended = await runHooks(hooks, "turn_end", {
      cwd: paths.syncedWorkspace,
      extra: { ROAN_CHAIN: current.identity.chainId, ROAN_SESSION: sessionId },
    });
    for (const result of ended) {
      if (result.exitCode !== 0) log(`hook turn_end failed (${String(result.exitCode)}): ${result.command}`);
    }
  };

  const onCreate = async (): Promise<ChainResponse> => {
    // Creating twice must not make a second chain: a double tap on the button,
    // or a client that asks again after a reconnect, would otherwise leave this
    // device with two identities and half its history in each.
    if (session !== null) {
      const existing = session.identity;
      return {
        t: "chain",
        chain: existing.chainId,
        node: existing.nodeId,
        invite: encodeJoinCode({
          v: 2,
          chain: existing.chainId,
          token: existing.token,
          hosts: dialHosts(paths),
          port: PEER_PORT,
        }),
      };
    }
    const created = await createIdentity(paths);
    session = { identity: created, store: EventStore.open(paths.database) };
    const invite = encodeJoinCode({
      v: 2,
      chain: created.chainId,
      token: created.token,
      hosts: dialHosts(paths),
      port: PEER_PORT,
    });
    await startReplication();
    await startEnvLoop();
    await startWorkspaceLoop();
    await startCron();
    // The first conversation exists from the start: an empty session list in
    // the drawer reads as a bug, and every reference app opens a conversation
    // the moment you create an account/chain.
    startSession("New chat");
    return { t: "chain", chain: created.chainId, node: created.nodeId, invite };
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
    port: CONTROL_PORT,
    // Standaard alleen loopback: de app op dit toestel is de enige die er iets
    // te zoeken heeft. Zet ROAN_CONTROL_HOST alleen op een adres als de app er
    // bewust van een andere machine bij moet kunnen.
    host: process.env["ROAN_CONTROL_HOST"] ?? "127.0.0.1",
    store: () => session?.store ?? null,
    state,
    onMessage: runMessage,
    onRequest: async (kind, data, reply) => {
      try {
        if (kind === "workspace_list") {
          const scanned = await scanWorkspace(paths.syncedWorkspace);
          reply({
            files: [...scanned.values()]
              .map((entry) => ({ path: entry.path, bytes: entry.bytes, hash: entry.hash }))
              .sort((a, b) => a.path.localeCompare(b.path)),
          });
          return;
        }
        if (kind === "workspace_read") {
          const path = typeof data["path"] === "string" ? data["path"] : "";
          const full = resolve(paths.syncedWorkspace, path);
          if (!full.startsWith(paths.syncedWorkspace)) {
            reply({ error: "buiten de werkmap" });
            return;
          }
          reply({ path, content: await readFileAsync(full, "utf8") });
          return;
        }
        if (kind === "workspace_write") {
          const path = typeof data["path"] === "string" ? data["path"] : "";
          const content = typeof data["content"] === "string" ? data["content"] : null;
          if (content === null || session === null) {
            reply({ error: "geen inhoud" });
            return;
          }
          const full = resolve(paths.syncedWorkspace, path);
          if (!full.startsWith(paths.syncedWorkspace)) {
            reply({ error: "buiten de werkmap" });
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
            engine: settings.engine,
          });
          return;
        }
        if (kind === "mcp_list") {
          // The file is what travels; the builtin engine does not start servers
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
        reply({ error: "onbekend verzoek: " + kind });
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
    onRenameSession: (wanted: string, title: string) => {
      if (session === null) return;
      const current = session;
      const index = readSessions(current.store.read(current.identity.chainId, 1, 100_000));
      if (!index.sessions.some((entry) => entry.id === wanted)) return;
      current.store.append(current.identity.chainId, {
        id: uuid(),
        node: current.identity.nodeId,
        type: "session_title",
        data: { session: wanted, title },
      });
      control?.sendState();
    },
    onNewSession: (title?: string) => {
      const id = startSession(title);
      if (id !== null) log("session: started " + id.slice(0, 8));
    },
    onCreate,
    onJoin,
    log: (message) => process.stderr.write(message + "\n"),
  });

  const st = state();
  process.stderr.write(
    st.onboarding
      ? "roan daemon: waiting for a chain (control port " + control.port + ")\n"
      : "roan daemon: chain " + String(st.chain) + ", node " + String(st.node) + ", control port " + control.port + "\n",
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
