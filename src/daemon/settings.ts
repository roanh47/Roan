import { readFile } from "node:fs/promises";
import type { RoanPaths } from "./paths.js";
import { isEffortLevel, type EffortLevel } from "../providers/effort.js";

/**
 * Owner-granted capabilities. Every flag defaults to off; a hand-edited config
 * can only turn one on by writing the boolean `true`, never a string.
 */
export interface AccessSettings {
  /**
   * `access.fullDisk`: the agent's file tools may reach paths outside the
   * workspace. Default off. A permission, not a sandbox escape — see
   * docs/security.md.
   */
  readonly fullDisk: boolean;
}

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
  readonly access: AccessSettings;
}

const DEFAULTS: Settings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "local-model",
  engine: "builtin",
  apiKey: "",
  provider: "lmstudio",
  effort: "normal",
  access: { fullDisk: false },
};

/** Only a literal `true` turns a capability on; `"true"` and `1` stay off. */
function parseAccess(raw: unknown): AccessSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { fullDisk: false };
  }
  const fullDisk = (raw as Record<string, unknown>)["fullDisk"];
  return { fullDisk: fullDisk === true };
}

export async function loadSettings(paths: RoanPaths): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch {
    return DEFAULTS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    const pick = (key: "baseUrl" | "model" | "apiKey" | "provider"): string => {
      const value = parsed[key];
      if (typeof value === "string") return value;
      return DEFAULTS[key];
    };
    // Roan runs its own loop. Another engine is something this one machine
    // asks for by name in its environment; the `engine` value in a config
    // file was never a choice anyone made (it was the old default, written
    // out), so it is not read.
    const engine = process.env["ROAN_ENGINE"] === "hermes" ? "hermes" : "builtin";
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
      access: parseAccess(parsed["access"]),
    };
  } catch {
    return DEFAULTS;
  }
}
