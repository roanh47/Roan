/**
 * A scripted, OpenAI-compatible streaming server for tests and local dev.
 *
 * `POST /v1/chat/completions` is answered from a queue of scripted responses:
 * either a list of SSE chunks (text deltas, tool-call deltas, a chunk carrying
 * `usage`) or a scripted HTTP error. When the queue runs dry the server answers
 * with a minimal text completion instead of hanging, so a missing `enqueue`
 * shows up as a wrong answer in the test rather than as a timeout.
 *
 * The wire format mirrors what `src/providers/openai-compat.ts` consumes:
 * `data: {...}\n\n` per chunk and a closing `data: [DONE]\n\n`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** Address the stub binds to; loopback only, never reachable off the host. */
const HOST = "127.0.0.1";

/** The single route this server implements. */
const COMPLETIONS_PATH = "/v1/chat/completions";

/** Object type string every streamed chunk carries. */
const OBJECT = "chat.completion.chunk";

/** Upper bound on a buffered request body, so a runaway client cannot OOM us. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Text returned when the script is exhausted. */
const FALLBACK_TEXT = "stub provider: no scripted response left";

/** Model name echoed back when the request does not name one. */
const DEFAULT_MODEL = "stub-model";

/** Token counts a scripted chunk may carry; shaped like OpenAI's `usage`. */
export interface StubUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens?: number;
}

/** One text delta: appended verbatim to the assistant message. */
export interface StubTextChunk {
  readonly content: string;
}

/**
 * One tool-call fragment. Like OpenAI, fragments may be split across chunks:
 * send `id` and `name` on the first one and `arguments` pieces afterwards.
 */
export interface StubToolCallChunk {
  /** `index` of the tool call; defaults to 0. */
  readonly index?: number;
  /** Call id; usually only on the first fragment. */
  readonly id?: string;
  /** Function name; usually only on the first fragment. */
  readonly name?: string;
  /** Raw JSON argument text, appended fragment by fragment. */
  readonly arguments?: string;
}

/** A chunk whose only payload is the final `usage` object. */
export interface StubUsageChunk {
  readonly usage: StubUsage;
}

/** One element of a scripted response. */
export type ScriptedChunk = StubTextChunk | StubToolCallChunk | StubUsageChunk;

/** A scripted non-2xx response instead of a stream. */
export interface StubHttpError {
  readonly status: number;
  /** Response body, sent as-is. */
  readonly body: string;
  /** Content type; defaults to `application/json`. */
  readonly contentType?: string;
}

/**
 * One entry of the queue: either `chunks` (streamed) or `error` (short-circuited).
 * The two are mutually exclusive so a typo cannot silently produce both.
 */
export type ScriptedResponse =
  | { readonly chunks: readonly ScriptedChunk[]; readonly error?: undefined }
  | { readonly error: StubHttpError; readonly chunks?: undefined };

/** A request the stub received, with the body already parsed as JSON. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  /** Parsed JSON body, or `null` when the body was empty or not valid JSON. */
  readonly body: unknown;
}

/** The running stub server. */
export interface StubProvider {
  /** Base URL including the `/v1` suffix, e.g. `http://127.0.0.1:41234/v1`. */
  readonly baseUrl: string;
  /** Actual listening port (assigned by the OS). */
  readonly port: number;
  /** Requests seen so far, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** Appends one response to the end of the queue. */
  enqueue(response: ScriptedResponse): void;
  /** Stops listening, drops open sockets and resolves once the port is free. */
  close(): Promise<void>;
}

/** A streamed tool-call fragment in OpenAI wire shape. */
interface WireToolCall {
  index: number;
  id?: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The `delta` object of a streamed choice. */
interface WireDelta {
  content?: string;
  tool_calls?: WireToolCall[];
}

/** One `choices[]` entry of a streamed chunk. */
interface WireChoice {
  index: number;
  delta: WireDelta;
  finish_reason: string | null;
}

/** Everything the stub writes per `data:` line. */
interface WireChunk {
  id: string;
  object: typeof OBJECT;
  created: number;
  model: string;
  choices: WireChoice[];
  usage?: StubUsage;
}

/** Narrows a parsed JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Splits a request target into its path, dropping any query string. */
function pathnameOf(url: string): string {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

/** Parses a body, treating malformed or empty input as `null` (recorded, not fatal). */
function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** Model name to echo in the stream, taken from the request body when present. */
function modelOf(body: unknown): string {
  if (isRecord(body) && typeof body.model === "string" && body.model !== "") {
    return body.model;
  }
  return DEFAULT_MODEL;
}

/** Coerces one body chunk to a Buffer, rejecting shapes we cannot read. */
function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new Error(`stub provider: unexpected request body chunk of type ${typeof chunk}`);
}

/** Reads the whole request body, refusing anything over `MAX_BODY_BYTES`. */
async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<unknown>) {
    const buf = toBuffer(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(
        `stub provider: request body exceeded ${String(MAX_BODY_BYTES)} bytes; refusing to buffer it`,
      );
    }
    parts.push(buf);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** Renders one tool-call fragment in wire shape. */
function wireToolCall(piece: StubToolCallChunk): WireToolCall {
  return {
    index: piece.index ?? 0,
    // Spread keeps `id` absent (not `undefined`) when the script omits it.
    ...(piece.id === undefined ? {} : { id: piece.id }),
    type: "function",
    function: { name: piece.name ?? "", arguments: piece.arguments ?? "" },
  };
}

/**
 * Turns one scripted response into its chunks.
 *
 * Text and tool-call fragments keep their scripted order; `usage` chunks are
 * held back and appended after the `finish_reason` chunk, which is what real
 * OpenAI streams do (finish chunk first, usage last).
 */
function buildChunks(
  scripted: readonly ScriptedChunk[],
  model: string,
  id: string,
  created: number,
): WireChunk[] {
  const body: WireChunk[] = [];
  const usage: WireChunk[] = [];
  let sawToolCall = false;

  for (const piece of scripted) {
    if ("usage" in piece) {
      usage.push({ id, object: OBJECT, created, model, choices: [], usage: piece.usage });
      continue;
    }

    if ("content" in piece) {
      body.push({
        id,
        object: OBJECT,
        created,
        model,
        choices: [{ index: 0, delta: { content: piece.content }, finish_reason: null }],
      });
      continue;
    }

    sawToolCall = true;
    body.push({
      id,
      object: OBJECT,
      created,
      model,
      choices: [
        { index: 0, delta: { tool_calls: [wireToolCall(piece)] }, finish_reason: null },
      ],
    });
  }

  body.push({
    id,
    object: OBJECT,
    created,
    model,
    choices: [
      { index: 0, delta: {}, finish_reason: sawToolCall ? "tool_calls" : "stop" },
    ],
  });

  return [...body, ...usage];
}

/** Opens an SSE response. */
function writeStreamHead(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

/** Writes one `data:` frame. */
function writeFrame(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Closes the stream with the `[DONE]` sentinel. */
function endStream(res: ServerResponse): void {
  res.write("data: [DONE]\n\n");
  res.end();
}

/** Answers with a JSON error object and no keep-alive, so unread bodies cannot poison the socket. */
function respondJson(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify({ error: { message } });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    connection: "close",
    ...headers,
  });
  res.end(body);
}

/**
 * Starts the stub on an ephemeral loopback port.
 *
 * `script` seeds the queue; anything enqueued later is served after that.
 */
export async function createStubProvider(
  script: readonly ScriptedResponse[] = [],
): Promise<StubProvider> {
  const queue: ScriptedResponse[] = [...script];
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();

  let streams = 0;
  let closed = false;
  let fatal: Error | null = null;

  /** Handles one request end to end; never leaves the response hanging. */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A client aborting mid-stream is normal in tests; don't crash the process.
    res.on("error", () => {});

    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const path = pathnameOf(url);

    if (path !== COMPLETIONS_PATH) {
      respondJson(res, 404, `stub provider: no route for ${method} ${url}`);
      return;
    }
    if (method !== "POST") {
      respondJson(res, 405, `stub provider: ${method} ${url} is not allowed; use POST`, {
        allow: "POST",
      });
      return;
    }

    const body = parseJson(await readBody(req));
    requests.push({ method, url, body });

    const scripted = queue.shift();
    if (scripted === undefined) {
      // Dry queue: still answer with something the adapter can parse.
      const id = `chatcmpl-stub-${String(++streams)}`;
      const created = Math.floor(Date.now() / 1000);
      writeStreamHead(res);
      writeFrame(res, {
        id,
        object: OBJECT,
        created,
        model: modelOf(body),
        choices: [{ index: 0, delta: { content: FALLBACK_TEXT }, finish_reason: null }],
      } satisfies WireChunk);
      writeFrame(res, {
        id,
        object: OBJECT,
        created,
        model: modelOf(body),
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      } satisfies WireChunk);
      endStream(res);
      return;
    }

    if (scripted.error !== undefined) {
      const { status, body: text, contentType } = scripted.error;
      res.writeHead(status, {
        "content-type": contentType ?? "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(text)),
        connection: "close",
      });
      res.end(text);
      return;
    }

    const id = `chatcmpl-stub-${String(++streams)}`;
    const created = Math.floor(Date.now() / 1000);
    const chunks = buildChunks(scripted.chunks ?? [], modelOf(body), id, created);

    writeStreamHead(res);
    for (const chunk of chunks) writeFrame(res, chunk);
    endStream(res);
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      respondJson(res, 500, `stub provider: request failed: ${message}`);
    });
  });

  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: Error): void => {
      reject(new Error(`stub provider: listen on ${HOST}:0 failed: ${error.message}`));
    };
    server.once("error", onListenError);
    server.listen(0, HOST, () => {
      server.off("error", onListenError);
      resolve();
    });
  });

  // After `listen`, errors are reported through `close()` instead of crashing.
  server.on("error", (error: Error) => {
    fatal = new Error(`stub provider: server error after listen: ${error.message}`);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error(
      `stub provider: expected a TCP address after listen, got ${JSON.stringify(address)}`,
    );
  }
  const port = address.port;

  return {
    baseUrl: `http://${HOST}:${String(port)}/v1`,
    port,
    requests,
    enqueue(response: ScriptedResponse): void {
      if (closed) {
        throw new Error("stub provider: enqueue after close is not possible");
      }
      queue.push(response);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(new Error(`stub provider: closing the server failed: ${error.message}`));
            return;
          }
          if (fatal) reject(fatal);
          else resolve();
        });
        // Keep-alive sockets would otherwise hold `close()` open for seconds.
        for (const socket of sockets) socket.destroy();
        sockets.clear();
      });
    },
  };
}
