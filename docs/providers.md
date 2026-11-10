# Providers

Two layers, and nothing above them knows a wire format: the **catalog** says who
a provider is, the **adapter** says how to talk to it. `src/providers/README.md`
is the working guide; this page describes what `src/providers/` does today and
where it is not yet connected.

## The adapter contract

`src/providers/adapter.ts` is the only shared surface between adapters.

```ts
interface ChatAdapter {
  readonly id: string;                    // the protocol, not the vendor
  send(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

interface ChatResponse {
  readonly message: ChatMessage;          // role "assistant", content and/or tool_calls
  readonly usage: Usage | null;           // null when the provider reported nothing
}

interface Usage { readonly inputTokens: number; readonly outputTokens: number; }
```

`ChatOptions` carries `tools` (OpenAI function-tool shape, passed through
opaquely), `onDelta(text)`, `signal`, and the optional `maxTokens` and
`temperature`. `ProviderConfig`/`AdapterConfig` is `{ baseUrl, apiKey, model }`;
an empty `apiKey` is legal and means "local server, no key".

Errors are `ProviderError` (`provider`, `status`, message). The factory fills
`provider` with the catalog id, an adapter with its protocol id — `"google"`,
`"anthropic"`, `"openai-compat"`.

## What a streaming reply looks like

`send()` is one promise, not a stream. The adapter opens the HTTP request, reads
the SSE body itself, appends each fragment to a local accumulator **and** calls
`opts.onDelta(fragment)` as it arrives. When the body ends it resolves once with
the assembled assistant message and whatever usage it saw.

The caller therefore sees zero or more `onDelta(text)` calls in order, then one
resolution with `{ message, usage }`: `message.content` is the concatenation of
everything passed to `onDelta` (`null` when empty) and `message.tool_calls` holds
the complete tool calls.

Each adapter reads a different event shape:

| file | endpoint | what it parses |
| --- | --- | --- |
| `src/providers/openai-compat.ts` | `POST {baseUrl}/chat/completions`, `stream: true` | `data:` chunks, `choices[0].delta.content`, `delta.tool_calls` merged by `index` |
| `src/providers/anthropic.ts` | `POST {baseUrl}/messages` | `message_start` (input tokens), `content_block_start`/`content_block_delta` (`text_delta`, `input_json_delta`), `message_delta` (output tokens), `error` |
| `src/providers/google.ts` | `POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse` | `candidates[].content.parts[].text` and `.functionCall`, `usageMetadata`, `promptFeedback.blockReason` |

- Usage is whatever the provider sends. `openai-compat.ts` omits
  `stream_options.include_usage`, so OpenAI itself usually yields `usage: null`;
  a provider that attaches counts to the final chunk does not.
- Anthropic supplies `max_tokens: 4096` when the caller sets none, because that
  API rejects a request without a cap. Google appends a `[google: …]` note
  instead of throwing when a safety block or non-STOP finish ends the stream.

There is no incremental tool-call callback and no partial-message stream on the
contract: tool calls only appear complete in the resolved `ChatResponse`.

## How `factory.ts` resolves a provider id

`createAdapter(providerId, cfg)` looks at three signals, most explicit first:

1. **An id override** — `anthropic`, `google`, `google-vertex`, `openai`, `xai`
   are pinned so a catalog change (`npm` or `api` moving) cannot reroute them.
2. **The catalog `npm` package** — `@ai-sdk/anthropic` → `anthropic`;
   `@ai-sdk/google` and `@ai-sdk/google-vertex` → `google`;
   `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@aihubmix/ai-sdk-provider`,
   `@ai-sdk/xai` → `openai-compat`; anything else falls through.
3. **The catalog `api` host** — `api.anthropic.com` → `anthropic`,
   `generativelanguage.googleapis.com` → `google`, any other host → `openai-compat`.
   An unparseable URL also lands on `openai-compat`.

Unsupported is an error, never a default:

- id not in the catalog → `ProviderError("unknown provider: <id> is not in the catalog")`;
- id in the catalog but no recognized `npm` and no `api` → `ProviderError("unsupported provider: …")`.

`protocolFor(id)` returns the protocol or `null` for exactly those two cases;
`isSupported(id)` is `protocolFor(id) !== null`; `supportedProviders()` filters
`listProviders()` through `protocolFor` and caches the sorted result.

## Where the catalog comes from

`src/providers/catalog.ts` is a generated snapshot of **models.dev**
(`https://models.dev/api.json`), written by `scripts/gen-catalog.mjs`; its header
says not to edit it by hand. The current snapshot records
`generatedAt: "2026-11-08T20:52:03.261Z"`. Shapes live in
`src/providers/types.ts`: a provider has `id`, `name`, `env`, optional `api` and
`doc`, required `npm`, and `models` keyed by model id (`context`, `output`,
`inputCost`, `outputCost`, `toolCall`, `attachment`, `reasoning`, `status`).

Read it through `src/providers/lookup.ts` — `listProviders()`, `modelsFor(id)`
(empty when unknown), `findModel(providerId, modelId)` (`undefined` when
unknown) — which returns frozen lists sorted by string comparison and caches
them. `factory.ts` takes `CATALOG` from `lookup.js`, never the generated file.

## How `retry.ts` decides what is retryable

`isRetryableStatus(n)` is true for `429` and `500–599` only. `400`, `401`, `403`,
`404`, `409` and `422` are permanent, and a non-finite status is never retryable.

`withRetry(fn, opts)` retries when:

- the value `fn` resolved has a numeric `status` that `isRetryableStatus` accepts
  (read structurally, so a plain object works and `Response` need not exist);
- the rejection is a `ProviderError` whose `status` is retryable;
- the rejection is a `TypeError` — the `fetch` failure shape, i.e. the wire never
  carried a reply.

Anything else — an abort, a non-retryable status, a bug — surfaces on the first
try, unwrapped. Defaults: 4 attempts, backoff from 500 ms, doubling, capped at
20 s, plus up to 25 % jitter. A `Retry-After` (delta-seconds or HTTP-date, via
`parseRetryAfter`) wins over the backoff but is still clamped to `maxDelayMs`; a
past date means `0`. When attempts run out, the last response is returned as-is
and the last error rethrown — nothing is wrapped or swallowed. `sleep`, `random`
and `signal` are injectable.

**Not wired:** no adapter calls `withRetry`, and none sets `retryAfterMs` on the
errors it throws (`retry.ts` accepts one, nothing produces it). Note that
`anthropic.ts` wraps a `fetch` failure in a `ProviderError` with `status: null`,
which this policy treats as permanent. The policy exists and is tested; a failed
provider call today reaches the caller on the first failure.

## How `usage.ts` keeps totals

A module-level `Map<string, { inputTokens, outputTokens, requests }>` keyed by an
opaque chain id — usually one conversation. Nothing is persisted and nothing is
printed.

- `recordUsage(chainId, usage)` adds one request. `null` usage still increments
  `requests` and adds no tokens; non-finite counts are treated as zero.
- `usageFor(chainId)` returns a copy — zeros for an unseen chain, never throws;
  `resetUsage(chainId)` forgets one chain, `allUsage()` is a frozen snapshot.
- `estimatedCost(chainId, inputCostPerMTok, outputCostPerMTok)` prices those
  totals at the rates given, rounded to six decimals; it does not look the price
  up in the catalog itself.

Totals are per chain, in memory, and die with the process. `recordUsage` has no
caller in `src/` today: the agent loop never feeds it a `ChatResponse.usage`.

## What is on the live path

`src/provider.ts` re-exports `chat` from `src/providers/openai-compat.ts`, and
that is what `src/agent.ts` calls. The running loop therefore always speaks
`openai-compat`; `createAdapter` is reached today only by
`src/providers/factory.test.ts`. The adapters, the retry policy and the usage
store are implemented and unit-tested, but the loop does not yet route through
the factory, retry a call, or record usage. For adding a provider or protocol,
follow `src/providers/README.md`.
