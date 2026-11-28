import { readFile } from "node:fs/promises";
import type { RoanPaths } from "./paths.js";
import { isEffortLevel, type EffortLevel } from "../providers/effort.js";
import { NO_AUXILIARY, parseAuxiliary, type AuxiliarySettings } from "./auxiliary.js";

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
  /**
   * A second model of the same provider, tried once when a request to the
   * first one fails before it answered anything. Empty means none.
   */
  readonly fallbackModel: string;
  /** A model of its own for a job the main one is wrong for; see auxiliary.ts. */
  readonly auxiliary: AuxiliarySettings;
  /**
   * Only a device itself may open its UI and control socket; the tailnet is
   * refused. Off by default. Synced like every setting: it holds on all
   * devices of the chain.
   */
  readonly deviceOnly: boolean;
  /**
   * Computer use permissions: conversation id → the moment it ends, in
   * milliseconds. Synced, so a permission given on one device counts on the
   * device that is being controlled.
   */
  readonly computerGrants: Readonly<Record<string, number>>;
}

const DEFAULTS: Settings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "local-model",
  apiKey: "",
  provider: "lmstudio",
  effort: "normal",
  access: { fullDisk: false },
  fallbackModel: "",
  auxiliary: NO_AUXILIARY,
  deviceOnly: false,
  computerGrants: {},
};

/** Conversation → end time; anything that is not a finite number is dropped. */
export function parseComputerGrants(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const grants: Record<string, number> = {};
  for (const [session, until] of Object.entries(raw as Record<string, unknown>)) {
    if (session.length > 0 && typeof until === "number" && Number.isFinite(until)) grants[session] = until;
  }
  return grants;
}

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
    // A hand-edited config may hold anything; an unknown level falls back to
    // the default instead of reaching a provider as a nonsense knob.
    const level: unknown = parsed["effort"];
    return {
      baseUrl: pick("baseUrl"),
      model: pick("model"),
      apiKey: pick("apiKey"),
      provider: pick("provider"),
      effort: isEffortLevel(level) ? level : DEFAULTS.effort,
      access: parseAccess(parsed["access"]),
      fallbackModel: typeof parsed["fallbackModel"] === "string" ? parsed["fallbackModel"].trim() : "",
      auxiliary: parseAuxiliary(parsed["auxiliary"]),
      deviceOnly: parsed["deviceOnly"] === true,
      computerGrants: parseComputerGrants(parsed["computerGrants"]),
    };
  } catch {
    return DEFAULTS;
  }
}
