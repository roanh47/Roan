import { readFile } from "node:fs/promises";
import type { RoanPaths } from "./paths.js";

/** What the user picked in the app. Never environment variables. */
export interface Settings {
  readonly baseUrl: string;
  readonly model: string;
  /** Who runs a turn: the engine on this machine, or the loop inside Roan. */
  readonly engine: "builtin" | "hermes";
  readonly apiKey: string;
  readonly provider: string;
}

const DEFAULTS: Settings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "local-model",
  engine: "hermes",
  apiKey: "",
  provider: "lmstudio",
};

export async function loadSettings(paths: RoanPaths): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch {
    return DEFAULTS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    const pick = (key: keyof Settings): string => {
      const value = parsed[key];
      return typeof value === "string" ? value : DEFAULTS[key];
    };
    const engine = pick("engine") === "builtin" || process.env["ROAN_ENGINE"] === "builtin" ? "builtin" : "hermes";
    return {
      engine,
      baseUrl: pick("baseUrl"),
      model: pick("model"),
      apiKey: pick("apiKey"),
      provider: pick("provider"),
    };
  } catch {
    return DEFAULTS;
  }
}
