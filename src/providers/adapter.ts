/**
 * The contract every provider adapter speaks.
 *
 * This file is the only shared surface between adapters: `src/provider.ts`
 * delegates here, and each adapter (openai-compat, anthropic, google) is
 * written against these types so the agent loop never learns a provider's
 * wire format.
 */
import type { ChatMessage } from "../types.js";

/** How to reach a provider: where, with which key, for which model. */
export interface ProviderConfig {
  /** Base URL of the provider API, without a trailing slash requirement. */
  readonly baseUrl: string;
  /** API key. Empty string means "no key" (local servers such as LM Studio). */
  readonly apiKey: string;
  /** Model id as the provider spells it. */
  readonly model: string;
}

/** `AdapterConfig` is an alias so adapter files can be read on their own. */
export type AdapterConfig = ProviderConfig;

/** Token counts as reported by the provider. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Per-call knobs the agent loop hands to an adapter. */
export interface ChatOptions {
  /** Tool definitions in OpenAI function-tool shape, passed through opaquely. */
  tools?: unknown[];
  /** Called with each text fragment as it streams in. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal | undefined;
  /** Optional per-call output cap. */
  maxTokens?: number | undefined;
  /** Optional sampling temperature. */
  temperature?: number | undefined;
}

/** One model answer plus whatever usage the provider disclosed. */
export interface ChatResponse {
  readonly message: ChatMessage;
  /** `null` when the provider did not report usage. */
  readonly usage: Usage | null;
}

/** A provider adapter. `id` names the wire protocol, not the provider. */
export interface ChatAdapter {
  readonly id: string;
  send(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

/** Builds an adapter for one provider configuration. */
export type AdapterFactory = (cfg: AdapterConfig) => ChatAdapter;

/**
 * An error that carries which provider failed and, when there was one, the
 * HTTP status. Messages never contain a key or a request body.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
