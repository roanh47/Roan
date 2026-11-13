import { randomUUID } from "node:crypto";
import { EventStore } from "../chain/store.js";
import type { ChainResponse, DaemonState } from "./control-protocol.js";
import { decodeJoinCode, encodeJoinCode } from "./control-protocol.js";
import { createIdentity, loadIdentity, type Identity } from "./identity.js";
import { ensurePaths, resolvePaths, type RoanPaths } from "./paths.js";
import { loadSettings } from "./settings.js";
import { startControlServer } from "./control.js";
import { ChainNodeStore } from "./peer-store.js";
import { addPeer, peers as peerList, startPeers, stopPeers } from "./peers.js";
import type { Logger } from "../sync/types.js";
import { runTurn } from "./turn-runner.js";
import { builtinTools } from "../tools.js";
import { contextTools } from "../tools/context-tools.js";
import { MemoryStore } from "../context/memory.js";
import { SkillLibrary } from "../context/skills.js";
import { buildSystemPrompt } from "../context/prompt.js";
import { adoptEnv, adoptEnvEvent, latestEnv, publishEnv } from "./env-sync.js";
import { join } from "node:path";
import { createRunOnNodeTool, serveDelegation, type RelayOptions } from "./relay.js";

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

function peerHost(paths: RoanPaths): string {
  return process.env["ROAN_PEER_HOST"] ?? "127.0.0.1";
}

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
  await ensurePaths(paths);
  const settings = await loadSettings(paths);

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
    onboarding: session === null,
    chain: session?.identity.chainId ?? null,
    node: session?.identity.nodeId ?? null,
    head: session ? session.store.head(session.identity.chainId) : 0,
    peers: peerList(),
    invite:
      session === null
        ? null
        : encodeJoinCode({
            v: 1,
            chain: session.identity.chainId,
            token: session.identity.token,
            host: peerHost(paths),
            port: PEER_PORT,
          }),
  });

  let control: Awaited<ReturnType<typeof startControlServer>> | null = null;
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
      const relayNow = relayOptions();
      if (relayNow === null) return;
      void serveDelegation(relayNow, event as unknown as import("../protocol/types.js").Event).catch((error: unknown) =>
        log("relay: " + String(error)),
      );
    });
    await startPeers({
      store: node,
      token: session.identity.token,
      host: peerHost(paths),
      port: PEER_PORT,
      logger: peerLogger,
      onError: (error) => log("peer error: " + error.message),
    });
    replicating = true;
    log("peer: listening on " + peerHost(paths) + ":" + String(PEER_PORT));
  };

  if (session !== null) await startReplication();

  /**
   * Keeps this device's copy equal to the chain: adopt what is newer, publish
   * what changed here. Runs on start and then quietly on a timer, so editing a
   * skill is enough — no command, no restart.
   */
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
      if (result.applied) log("env: adopted the chain's copy");
    }
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

  if (session !== null) await startEnvLoop();

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
    return [...tools, createRunOnNodeTool(relayNow, () => peerList())];
  };

  const runMessage = async (text: string): Promise<void> => {
    if (!session) return;
    const current = session;
    const systemPrompt = await agentContext.prompt();
    void runTurn(
      {
        store: current.store,
        chain: current.identity.chainId,
        node: current.identity.nodeId,
        provider: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
        cwd: paths.syncedWorkspace,
        systemPrompt,
        tools: toolsForTurn(),
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
          v: 1,
          chain: existing.chainId,
          token: existing.token,
          host: peerHost(paths),
          port: PEER_PORT,
        }),
      };
    }
    const created = await createIdentity(paths);
    session = { identity: created, store: EventStore.open(paths.database) };
    const invite = encodeJoinCode({
      v: 1,
      chain: created.chainId,
      token: created.token,
      host: peerHost(paths),
      port: PEER_PORT,
    });
    await startReplication();
    await startEnvLoop();
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
      void startEnvLoop().catch((error: unknown) => log("env: " + String(error)));
    }, 2_500);
    addPeer({ host: parsed.host, port: parsed.port });
    log("peer: joined " + parsed.host + ":" + String(parsed.port));
    return { t: "chain", chain: joined.chainId, node: joined.nodeId };
  };

  control = await startControlServer({
    port: CONTROL_PORT,
    store: () => session?.store ?? null,
    state,
    onMessage: runMessage,
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
