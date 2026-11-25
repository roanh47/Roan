import os from "node:os";
import path from "node:path";
import type { ProviderConfig } from "./provider.js";

export interface Config extends ProviderConfig {
  cwd: string;
  systemPrompt: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cwd = overrides.cwd ?? process.cwd();
  return {
    baseUrl: overrides.baseUrl ?? process.env["ROAN_API_URL"] ?? "http://127.0.0.1:1234/v1",
    apiKey: overrides.apiKey ?? process.env["ROAN_API_KEY"] ?? "",
    model: overrides.model ?? process.env["ROAN_MODEL"] ?? "local-model",
    cwd,
    systemPrompt:
      overrides.systemPrompt ??
      [
        "You are Roan, a terminal agent. You work in the directory the user gave you.",
        "You have tools: read_file, write_file, list_dir and run_shell.",
        "Read a file before you change it. Never invent file content.",
        "Run tests or builds after a change and report the real result.",
        "Answer briefly in English by default; answer in Dutch when the user writes Dutch.",
        `System: ${os.type()} ${os.release()}, working directory ${path.basename(cwd) || cwd}.`,
      ].join("\n"),
  };
}
