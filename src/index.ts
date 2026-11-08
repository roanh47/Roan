#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { builtinTools } from "./tools.js";
import { App } from "./tui/app.js";

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

const HELP = `Roan — terminal agent

Gebruik
  roan                     start de TUI
  roan -p "opdracht"       één opdracht, print het antwoord en stop
  roan --model <naam>      ander model dan de omgeving aangeeft
  roan --cwd <map>         werk in een andere map

Omgeving
  ROAN_API_URL   basis-URL van een OpenAI-compatibel endpoint
                 (standaard http://127.0.0.1:1234/v1)
  ROAN_API_KEY   sleutel, leeg laten mag bij een lokale server
  ROAN_MODEL     modelnaam

Tools die het model kan gebruiken: read_file, write_file, list_dir, run_shell.`;

async function eenmalig(prompt: string, args: Args): Promise<void> {
  const config = loadConfig({ model: args.model, cwd: args.cwd });
  const agent = new Agent({
    provider: config,
    tools: builtinTools,
    systemPrompt: config.systemPrompt,
    cwd: config.cwd,
    onEvent: (e) => {
      if (e.type === "assistant_text") process.stdout.write(e.text);
      else if (e.type === "tool_start") process.stdout.write(`\n[${e.name}] ${e.args}\n`);
      else if (e.type === "tool_end") process.stdout.write(`[${e.ok ? "ok" : "fout"}] ${e.output.split("\n")[0]}\n`);
      else if (e.type === "error") process.stderr.write(`\nfout: ${e.message}\n`);
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
    await eenmalig(args.prompt, args);
    return;
  }

  const config = loadConfig({ model: args.model, cwd: args.cwd });
  const app = render(React.createElement(App, { config }));
  await app.waitUntilExit();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
