import { randomUUID } from "node:crypto";
import { EventStore } from "../chain/store.js";
import type { ChainResponse, DaemonState } from "./control-protocol.js";
import { decodeJoinCode, encodeJoinCode } from "./control-protocol.js";
import { createIdentity, loadIdentity, type Identity } from "./identity.js";
import { ensurePaths, resolvePaths, type RoanPaths } from "./paths.js";
import { loadSettings } from "./settings.js";
import { startControlServer } from "./control.js";
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
    peers: [],
  });

  let control: Awaited<ReturnType<typeof startControlServer>> | null = null;

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

main().catch((err: unknown) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
