/**
 * Picks a wire protocol for a catalog provider id and builds the adapter that
 * speaks it.
 *
 * The catalog says which SDK package a provider is served by (`npm`) and where
 * its API lives (`api`). Both are indirect evidence, so resolution goes from
 * the most explicit signal to the least:
 *
 *   1. an explicit provider-id override (families we know by name);
 *   2. the catalog `npm` package;
 *   3. the catalog `api` host.
 *
 * A provider that matches none of these is not a silent default: it is
 * unsupported, and asking for an adapter for it is an error.
 */
import {
  type AdapterConfig,
  type ChatAdapter,
  ProviderError,
} from "./adapter.js";
import { CATALOG, listProviders } from "./lookup.js";
import { createOpenAiCompatAdapter } from "./openai-compat.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createGoogleAdapter } from "./google.js";

/** The wire formats the agent loop can speak. */
export type Protocol = "openai-compat" | "anthropic" | "google";

/**
 * Provider ids whose protocol we pin by name, so a catalog change (`npm` or
 * `api` moving) cannot silently reroute a well-known provider.
 */
const OVERRIDES: Readonly<Record<string, Protocol>> = Object.freeze({
  anthropic: "anthropic",
  google: "google",
  "google-vertex": "google",
  openai: "openai-compat",
  xai: "openai-compat",
});

/** AI SDK packages that identify a protocol on their own. */
function protocolForNpm(npm: string): Protocol | null {
  switch (npm) {
    case "@ai-sdk/anthropic":
      return "anthropic";
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return "google";
    case "@ai-sdk/openai":
    case "@ai-sdk/openai-compatible":
    case "@aihubmix/ai-sdk-provider":
    case "@ai-sdk/xai":
      return "openai-compat";
    default:
      return null;
  }
}

/** Protocol implied by the host an API URL points at. */
function protocolForApiHost(api: string): Protocol {
  let host: string;
  try {
    host = new URL(api).host;
  } catch {
    // An unparseable URL still means "some HTTP endpoint" — the compat shape
    // is the only safe assumption left.
    return "openai-compat";
  }
  switch (host) {
    case "api.anthropic.com":
      return "anthropic";
    case "generativelanguage.googleapis.com":
      return "google";
    default:
      return "openai-compat";
  }
}

let supportedCache: readonly string[] | undefined;

/**
 * The protocol a catalog provider id speaks, or `null` when the catalog gives
 * us no way to tell (unknown id, or no recognized package and no API URL).
 */
export function protocolFor(providerId: string): Protocol | null {
  const override = OVERRIDES[providerId];
  if (override !== undefined) return override;

  const entry = CATALOG.providers[providerId];
  if (entry === undefined) return null;

  const fromNpm = protocolForNpm(entry.npm);
  if (fromNpm !== null) return fromNpm;

  if (entry.api !== undefined && entry.api !== "") {
    return protocolForApiHost(entry.api);
  }
  return null;
}

/** Whether `protocolFor` can answer for this provider id. */
export function isSupported(providerId: string): boolean {
  return protocolFor(providerId) !== null;
}

/** Every provider id we can build an adapter for, sorted. */
export function supportedProviders(): readonly string[] {
  supportedCache ??= Object.freeze(
    listProviders()
      .map((entry) => entry.id)
      .filter((id) => protocolFor(id) !== null)
      .sort(),
  );
  return supportedCache;
}

/**
 * Build the adapter for `providerId`.
 *
 * Throws `ProviderError` for an unknown id and for a known provider whose
 * protocol cannot be determined from the catalog.
 */
export function createAdapter(
  providerId: string,
  cfg: AdapterConfig,
): ChatAdapter {
  const entry = CATALOG.providers[providerId];
  if (entry === undefined) {
    throw new ProviderError(
      providerId,
      `unknown provider: ${providerId} is not in the catalog`,
      null,
    );
  }

  const protocol = protocolFor(providerId);
  if (protocol === null) {
    throw new ProviderError(
      providerId,
      `unsupported provider: ${providerId} (npm "${entry.npm}" has no known protocol` +
        (entry.api === undefined ? " and it has no api url)" : ")"),
      null,
    );
  }

  switch (protocol) {
    case "anthropic":
      return createAnthropicAdapter(cfg);
    case "google":
      return createGoogleAdapter(cfg);
    case "openai-compat":
      return createOpenAiCompatAdapter(cfg);
  }
}
