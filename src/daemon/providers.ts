import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoanPaths } from "./paths.js";

/**
 * The providers this person has, and which one is in use.
 *
 * One file in the agent home (`providers.json`), part of the env, so the list
 * travels with the chain exactly like the rest of the config. Picking a provider
 * copies its base URL and key into `config.json`, because that is what the turn
 * runner reads; the list itself is the UI's source of truth.
 */
export interface ProviderAccount {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Which known provider this came from, when it did. */
  readonly preset?: string;
}

export interface ProviderFile {
  readonly accounts: readonly ProviderAccount[];
  readonly active: string | null;
}

/** Providers that speak the OpenAI wire format, so no adapter work is needed. */
export const PRESETS: readonly { id: string; label: string; baseUrl: string; keyHint: string }[] = [
  { id: "opencode-go", label: "opencode go", baseUrl: "https://opencode.ai/inference/go/openai/v1", keyHint: "opencode.ai key" },
  { id: "opencode", label: "opencode zen", baseUrl: "https://opencode.ai/inference/openai/v1", keyHint: "opencode.ai key" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyHint: "sk-…" },
  { id: "google", label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyHint: "AIza…" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyHint: "gsk_…" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyHint: "…" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyHint: "sk-or-…" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyHint: "sk-…" },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", keyHint: "xai-…" },
  { id: "lmstudio", label: "LM Studio (this machine)", baseUrl: "http://127.0.0.1:1234/v1", keyHint: "no key needed" },
];

function file(paths: RoanPaths): string {
  return join(paths.home, "providers.json");
}

function asAccount(raw: unknown): ProviderAccount | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value["id"] === "string" ? value["id"] : "";
  const label = typeof value["label"] === "string" ? value["label"] : "";
  const baseUrl = typeof value["baseUrl"] === "string" ? value["baseUrl"] : "";
  const apiKey = typeof value["apiKey"] === "string" ? value["apiKey"] : "";
  if (id.length === 0 || label.length === 0 || baseUrl.length === 0) return null;
  const preset = typeof value["preset"] === "string" ? value["preset"] : undefined;
  return { id, label, baseUrl, apiKey, ...(preset !== undefined ? { preset } : {}) };
}

export async function loadProviders(paths: RoanPaths): Promise<ProviderFile> {
  let raw: string;
  try {
    raw = await readFile(file(paths), "utf8");
  } catch {
    return { accounts: [], active: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { accounts: [], active: null };
    const value = parsed as Record<string, unknown>;
    const list = Array.isArray(value["accounts"]) ? value["accounts"] : [];
    const accounts = list.map(asAccount).filter((item): item is ProviderAccount => item !== null);
    const active = typeof value["active"] === "string" ? value["active"] : null;
    return { accounts, active };
  } catch {
    return { accounts: [], active: null };
  }
}

/** Owner-only: the file holds API keys. */
export async function saveProviders(paths: RoanPaths, data: ProviderFile): Promise<void> {
  await writeFile(file(paths), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

/** Adds an account, or updates the one with the same id. */
export function upsertAccount(data: ProviderFile, account: ProviderAccount): ProviderFile {
  const rest = data.accounts.filter((item) => item.id !== account.id);
  return { accounts: [...rest, account], active: data.active };
}

export interface LiveModel {
  readonly id: string;
  readonly name: string;
}

/**
 * The models a provider actually serves, asked from the provider.
 *
 * models.dev is a catalogue, not a live answer: it lists what a provider
 * published, not what your key can reach (a plan, a region or a retired id all
 * differ). `GET {baseUrl}/models` is the only source that cannot be wrong about
 * the endpoint the turn will actually call.
 */
export async function fetchModels(account: ProviderAccount): Promise<{ models: LiveModel[]; error?: string }> {
  const url = `${account.baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const response = await fetch(url, {
      headers: {
        ...(account.apiKey.length > 0 ? { authorization: `Bearer ${account.apiKey}` } : {}),
        accept: "application/json",
        "user-agent": "Roan/0.0.6",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { models: [], error: `${new URL(url).host} answered ${String(response.status)}` };
    }
    const payload: unknown = await response.json();
    const list = (payload as { data?: unknown })?.data;
    if (!Array.isArray(list)) return { models: [], error: "that endpoint did not return a model list" };
    const models: LiveModel[] = [];
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const value = entry as Record<string, unknown>;
      const id = typeof value["id"] === "string" ? value["id"] : typeof value["name"] === "string" ? value["name"] : "";
      if (id.length === 0) continue;
      const name = typeof value["name"] === "string" && value["name"].length > 0 ? value["name"] : id;
      models.push({ id, name });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { models };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}
