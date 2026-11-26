import { readFile } from "node:fs/promises";
import type { RoanPaths } from "./paths.js";
import { isEffortLevel, type EffortLevel } from "../providers/effort.js";

/** What the user picked in the app. Never environment variables. */
export interface Settings {
  readonly baseUrl: string;
  readonly model: string;
  /** Who runs a turn: the engine on this machine, or the loop inside Roan. */
  readonly engine: "builtin" | "hermes";
  readonly apiKey: string;
  readonly provider: string;
  /**
   * How hard the model should think on every turn. A conversation-level
   * preference, not a per-message knob: it lives here so it survives a restart
   * and reaches the adapter as `ChatOptions.effort`. `normal` puts nothing on
   * the wire, which keeps every provider on its own default.
   */
  readonly effort: EffortLevel;
}

const DEFAULTS: Settings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "local-model",
  engine: "hermes",
  apiKey: "",
  provider: "lmstudio",
  effort: "normal",
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
    // A hand-edited config may hold anything; an unknown level falls back to
    // the default instead of reaching a provider as a nonsense knob.
    const level: unknown = parsed["effort"];
    return {
      engine,
      baseUrl: pick("baseUrl"),
      model: pick("model"),
      apiKey: pick("apiKey"),
      provider: pick("provider"),
      effort: isEffortLevel(level) ? level : DEFAULTS.effort,
    };
  } catch {
    return DEFAULTS;
  }
}
