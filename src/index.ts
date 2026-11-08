#!/usr/bin/env node
import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { builtinTools } from "./tools.js";

const VERSION = "0.1.0";

interface Args {
  prompt?: string;
  model?: string;
  cwd?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-p" || a === "--prompt") args.prompt = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--cwd") args.cwd = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-v" || a === "--version") args.version = true;
    else if (!args.prompt && !a.startsWith("-")) args.prompt = a;
  }
  return args;
}

const HELP = `Roan — one agent, several machines

Usage
  roan -p "task"           run one task, print the result and stop
  roan --model <name>      use another model than the environment says
  roan --cwd <dir>         work in another directory
  roan -h | --help         this text
  roan -v | --version      version

There is no terminal interface. The web UI is served by every node and shows the
same thing on a laptop, a server and a phone. Until it exists, -p is the way in.

Environment
  ROAN_API_URL   base URL of an OpenAI-compatible endpoint
                 (default http://127.0.0.1:1234/v1)
  ROAN_API_KEY   key, may be empty for a local server
  ROAN_MODEL     model name

Tools the model can use: read_file, write_file, list_dir, run_shell.`;

async function once(prompt: string, args: Args): Promise<void> {
  const config = loadConfig({ model: args.model, cwd: args.cwd });
  const agent = new Agent({
    provider: config,
    tools: builtinTools,
    systemPrompt: config.systemPrompt,
    cwd: config.cwd,
    onEvent: (e) => {
      if (e.type === "assistant_text") process.stdout.write(e.text);
      else if (e.type === "tool_start") process.stdout.write(`\n[${e.name}] ${e.args}\n`);
      else if (e.type === "tool_end")
        process.stdout.write(`[${e.ok ? "ok" : "failed"}] ${e.output.split("\n")[0]}\n`);
      else if (e.type === "error") process.stderr.write(`\nerror: ${e.message}\n`);
    },
  });

  await agent.send(prompt);
  process.stdout.write("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(`roan ${VERSION}`);
    return;
  }
  if (args.prompt) {
    await once(args.prompt, args);
    return;
  }

  console.error("No task given. Run `roan -p \"...\"`. The web UI is not built yet.");
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
