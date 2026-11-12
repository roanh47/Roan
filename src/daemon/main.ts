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

const CONTROL_PORT = Number(process.env["ROAN_CONTROL_PORT"] ?? 7411);
const PEER_PORT = Number(process.env["ROAN_PEER_PORT"] ?? 7412);

const SYSTEM_PROMPT = [
  "You are Roan, an agent running on one of the user's machines.",
  "You work inside the user's folder and you have tools: read_file, write_file, list_dir and run_shell.",
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

async function main(): Promise<void> {
  const paths = resolvePaths();
  await ensurePaths(paths);
  const settings = await loadSettings(paths);

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

  const runMessage = (text: string): void => {
    if (!session) return;
    const current = session;
    void runTurn(
      {
        store: current.store,
        chain: current.identity.chainId,
        node: current.identity.nodeId,
        provider: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
        cwd: paths.syncedWorkspace,
        systemPrompt: SYSTEM_PROMPT,
        onAppend: (event) => control?.broadcast({ t: "append", event }),
      },
      text,
    );
  };

  const onCreate = async (): Promise<ChainResponse> => {
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
