# Providers

Two layers. The catalog says **who** a provider is. The adapter says **how** to
speak to it. Nothing else in the agent loop knows a provider's wire format.

| layer | file | answer |
| --- | --- | --- |
| catalog | `catalog.ts`, `types.ts`, `lookup.ts` | id, name, env var, API base, which models exist |
| adapter | `adapter.ts` plus one file per protocol | request shape, streaming, tool calls, usage |

## The catalog

`catalog.ts` is generated from models.dev by `scripts/gen-catalog.mjs`; never
edit it by hand. A `Provider` (`types.ts`) carries `id`, `name`, `env` (the
variables that may hold a key), optional `api`, `doc`, and `npm` — the AI SDK
package models.dev says serves it. A `CatalogEntry` adds `models`, keyed by
model id, each with `context`, `output`, `inputCost`, `outputCost`, `toolCall`,
`attachment`, `reasoning` and `status`.

Read it through `lookup.ts`: `listProviders()`, `modelsFor(id)` (empty when
unknown), `findModel(providerId, modelId)` (`undefined` when either is unknown).
Results are frozen, sorted by id and cached. A provider models.dev already
knows is a catalog regeneration, not code; one it does not know is a protocol
question first.

## The ChatAdapter contract

`adapter.ts` is the only shared surface. Do not edit it to fit one provider.

```ts
export interface ChatAdapter {
  readonly id: string;                     // the protocol, not the provider
  send(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

export interface ChatResponse {
  readonly message: ChatMessage;
  readonly usage: Usage | null;            // null when the provider reported none
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}
```

`ChatOptions` carries `tools` (OpenAI function-tool shape, passed through
opaquely), `onDelta(text)` for streamed text fragments, `signal`, and optional
`maxTokens` and `temperature`. An empty `apiKey` means "no key" and is legal for
local servers. `ProviderError` carries the failing `provider` and an HTTP
`status`, and never a key or a request body.

## The three protocols

| protocol | file | factory export | wire shape |
| --- | --- | --- | --- |
| `openai-compat` | `openai-compat.ts` | `createOpenAiCompatAdapter` | `POST /chat/completions`, SSE `data:` lines, `tools`/`tool_calls` |
| `anthropic` | `anthropic.ts` | `createAnthropicAdapter` | `POST /v1/messages`, typed content blocks, `tool_use`/`tool_result` |
| `google` | `google.ts` | `createGoogleAdapter` | `generateContent`, `functionCall`/`functionResponse` parts |

All three stream and accept the same `ChatOptions`. `openai-compat.ts` also
exports `chat()` with the old `src/provider.ts` call shape, kept for existing
callers.

## Resolution

`createAdapter(providerId, cfg)` in `factory.ts` resolves in this order:

1. an explicit id override (`anthropic`, `google`, `google-vertex`, `openai`,
   `xai`), pinned so a catalog change cannot silently reroute a known provider;
2. the catalog `npm` package (`@ai-sdk/anthropic`, `@ai-sdk/google`,
   `@ai-sdk/openai-compatible`, `@ai-sdk/xai`, `@aihubmix/ai-sdk-provider`);
3. the host of the catalog `api` URL (`api.anthropic.com`,
   `generativelanguage.googleapis.com`), with any other host treated as
   `openai-compat`.

An unknown id, or a known provider with no recognized package and no API URL,
**throws** `ProviderError(providerId, ...)` naming the id. There is no default
adapter and no silent fallback: a wrong guess would send a key to the wrong
endpoint. `protocolFor(id)` returns `null` where `createAdapter` throws;
`isSupported(id)` and `supportedProviders()` answer the same question without
throwing.

Note the two kinds of `ProviderError.provider`: the factory sets it to the
catalog id, an adapter sets it to its protocol id (`"google"`, `"anthropic"`).
The message already names the failing thing.

## Adding a protocol

1. Write `src/providers/<protocol>.ts` exporting a
   `create<Name>Adapter(cfg: AdapterConfig): ChatAdapter`. Do the request
   mapping, streaming, tool-call mapping both ways and usage extraction here.
   Import types from `./adapter.js` and helpers from `./lookup.js` only.
2. Register it in `factory.ts`: add the protocol to `Protocol`, map the catalog
   `npm` packages and API hosts to it, and add a `case` to the switch in
   `createAdapter`. Add an id override only if the provider must never be
   re-routed by a catalog change.
3. Add a case to `factory.test.ts`. Every catalog id must either build an
   adapter or throw a `ProviderError` whose `provider` is that id; the test
   iterates the catalog, so a new protocol that leaves a hole fails.
4. Document it here: the table above, and any request shape the next person
   would otherwise have to reverse-engineer.

A minimal adapter:

```ts
// src/providers/example.ts
import {
  type AdapterConfig,
  type ChatAdapter,
  type ChatOptions,
  type ChatResponse,
  ProviderError,
} from "./adapter.js";
import type { ChatMessage } from "../types.js";

/** Replaces the key everywhere before text leaves this module. */
function redact(text: string, key: string): string {
  return key === "" ? text : text.split(key).join("[redacted]");
}

export function createExampleAdapter(cfg: AdapterConfig): ChatAdapter {
  return {
    id: "example",
    async send(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
      const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat`, {
        method: "POST",
        signal: opts.signal,
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: cfg.model, messages }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          "example",
          `example ${res.status}: ${redact(body, cfg.apiKey).slice(0, 400)}`,
          res.status,
        );
      }

      // Read the stream, call opts.onDelta(text) per fragment, collect tool
      // calls and usage, then return { message, usage }.
      return { message: { role: "assistant", content: "" }, usage: null };
    },
  };
}
```

## Retry

`retry.ts` is the policy, independent of any adapter.

- `isRetryableStatus(n)` is true for 429 and 500–599 only. 400, 401, 403, 404,
  409 and 422 are permanent: resending cannot help, so they surface on the
  first try.
- `parseRetryAfter(header, now)` accepts delta-seconds and the HTTP-date form;
  unparseable values return `undefined`, a past date returns `0`.
- `computeDelay(attempt, retryAfterMs, opts)` backs off from 500 ms, doubling,
  capped at 20 s, plus up to 25% jitter. A server `Retry-After` wins over the
  backoff but is still capped, so a provider cannot park the agent for an hour.
- `withRetry(fn, opts)` makes 4 attempts by default and retries a retryable
  status, a `ProviderError` with a retryable `status`, and a network `TypeError`.
  Otherwise the error or response surfaces on the first try, unwrapped.
  `signal`, `sleep` and `random` are injectable, so tests need no real time.

The adapters do not call `withRetry` yet and do not set `retryAfterMs` on the
errors they throw: the policy exists, nothing applies it.

## Usage

`usage.ts` keeps running token totals per chain, in memory only.

- `recordUsage(chainId, usage)` adds one request; a `null` usage still counts
  the request and adds no tokens; non-finite counts are treated as zero.
- `usageFor(chainId)` returns `{ inputTokens, outputTokens, requests }`, zeros
  for an unseen chain, never throws. `allUsage()` is a frozen snapshot;
  `resetUsage(chainId)` forgets one chain.
- `estimatedCost(chainId, inputCostPerMTok, outputCostPerMTok)` prices the
  totals at catalog rates, rounded to six decimals.

Nothing here persists and nothing logs. The caller renders the numbers.

## Picker helpers

`models-filter.ts` answers "which models may this user pick":

| export | meaning |
| --- | --- |
| `matchesFilter(model, filter)` | one model against the criteria |
| `filterModels(providerId, filter)` | that provider's models, sorted by id |
| `filterCatalog(filter)` | every provider/model pair, provider id then model id |
| `sortByPrice(models)` | cheapest input first, unknown prices last |
| `sortByContext(models)` | largest context first, unknown last |

`ModelFilter` is `tools`, `attachments`, `reasoning`, `minContext`,
`maxInputCost`, `maxOutputCost`, `excludeDeprecated`. An unset criterion
matches everything; a criterion that needs a field the model lacks fails.
`excludeDeprecated` drops `deprecated` and `alpha`.

`display.ts` is presentation only: `providerLabel(id)`, `modelLabel(providerId,
modelId)` (falling back to the id when the catalog has no name),
`modelBadges(providerId, modelId)` (`tools`, `vision`, `reasoning`, `1M ctx`,
`cheap`, in that order),
`orderedProviders()` (featured first, then id), and `searchModels(query,
limit)` — case-insensitive, ranked exact id, id prefix, id substring, name
substring, provider substring, tied by provider id then model id, 50 rows by
default.

## The one rule

A key must never appear in an error message, an event or a log line. That is
ground rule 6 in `AGENTS.md`, and a key in a log line is a leaked key.

- Send the key only in the request header. Never in a URL, never in a body.
- Error text is built from the status, the status text and the response body.
  Scrub the response body with the key before slicing it, as `google.ts` does:
  `text.split(apiKey).join("[redacted]")`.
- Never log the request body or the headers: both contain the key.
- `ProviderError` messages say what failed and on which input, not what was
  sent.

## Current gaps

`src/provider.ts` still has its own OpenAI-compatible client and does not
delegate to `openai-compat.ts`; `adapter.ts` describes the single path. `retry.ts`
has no callers. `factory.test.ts` sits beside the code because `tsconfig.json`
includes only `src` and `npm test` runs compiled `dist` tests.
