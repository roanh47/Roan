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
        "Je bent Roan, een terminal-agent. Je werkt in de map die de gebruiker heeft opgegeven.",
        "Je hebt tools: read_file, write_file, list_dir en run_shell.",
        "Lees een bestand voordat je het aanpast. Verzin nooit bestandsinhoud.",
        "Draai tests of builds als je iets hebt veranderd en meld het echte resultaat.",
        "Antwoord kort en in het Nederlands, tenzij de gebruiker iets anders vraagt.",
        `Systeem: ${os.type()} ${os.release()}, werkmap ${path.basename(cwd) || cwd}.`,
      ].join("\n"),
  };
}
