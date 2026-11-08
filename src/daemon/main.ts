import { EventStore } from "../chain/store.js";
import { createIdentity, loadIdentity } from "./identity.js";
import { ensurePaths, resolvePaths } from "./paths.js";
import { loadSettings } from "./settings.js";
import { startControlServer } from "./control.js";
import { runTurn } from "./turn-runner.js";

const CONTROL_PORT = 7411;

const SYSTEM_PROMPT = [
  "You are Roan, an agent running on one of the user's machines.",
  "You work inside the user's folder and you have tools: read_file, write_file, list_dir and run_shell.",
  "Read a file before you change it. Never invent file contents.",
  "Run the build or the tests after changing something, and report what actually happened.",
].join("\n");

async function main(): Promise<void> {
  const paths = resolvePaths();
  await ensurePaths(paths);

  const identity = (await loadIdentity(paths)) ?? (await createIdentity(paths));
  const settings = await loadSettings(paths);
  const store = EventStore.open(paths.database);

  let control: Awaited<ReturnType<typeof startControlServer>> | null = null;

  control = await startControlServer({
    store,
    chain: identity.chainId,
    node: identity.nodeId,
    port: CONTROL_PORT,
    onMessage: (text) => {
      void runTurn(
        {
          store,
          chain: identity.chainId,
          node: identity.nodeId,
          provider: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
          cwd: paths.syncedWorkspace,
          systemPrompt: SYSTEM_PROMPT,
          onAppend: (event) => control?.broadcast({ t: "append", event }),
        },
        text,
      );
    },
    log: (message) => process.stderr.write(message + "\n"),
  });

  process.stderr.write(
    "roan daemon: chain " + identity.chainId + ", node " + identity.nodeId + ", control port " + control.port + "\n",
  );
}

main().catch((err: unknown) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
