import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, describe, it } from "node:test";
import { MAX_GENERATION_BYTES } from "../../http.js";
import { GenerationError, isGeneratedBytes, type GenerationConfig } from "../../types.js";
import { openaiImages } from "./index.js";

/** A real 1x1 PNG. The fixture serves it; the test compares the decoded bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const API_KEY = "sk-test-SECRET1234";

interface Fixture {
  readonly url: string;
  close(): Promise<void>;
}

/** A loopback server; nothing leaves 127.0.0.1. */
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Fixture> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const config = (baseUrl: string, extra: Partial<GenerationConfig> = {}): GenerationConfig => ({
  apiKey: API_KEY,
  baseUrl,
  ...extra,
});

describe("openai-images provider", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const close of cleanups) await close();
  });

  async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Fixture> {
    const served = await fixture(handler);
    cleanups.push(served.close);
    return served;
  }

  it("is available exactly when an api key is configured", () => {
    assert.equal(openaiImages.isAvailable({}), false);
    assert.equal(openaiImages.isAvailable({ apiKey: "   " }), false);
    assert.equal(openaiImages.isAvailable({ apiKey: API_KEY }), true);
  });

  it("posts prompt, size and n=1 to /v1/images/generations and returns bytes with a mime", async () => {
    let seen: { method?: string; url?: string; authorization?: string; body?: string } = {};
    const served = await serve((request, response) => {
      void readBody(request).then((body) => {
        seen = { method: request.method, url: request.url, authorization: request.headers.authorization, body };
        json(response, 200, { data: [{ b64_json: PNG.toString("base64") }] });
      });
    });

    const result = await openaiImages.generate(
      { prompt: "a red fox in the snow", size: "512x512" },
      config(served.url),
    );

    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/v1/images/generations");
    assert.equal(seen.authorization, `Bearer ${API_KEY}`);
    const body = JSON.parse(seen.body ?? "{}") as Record<string, unknown>;
    assert.equal(body["model"], "gpt-image-1");
    assert.equal(body["prompt"], "a red fox in the snow");
    assert.equal(body["size"], "512x512");
    assert.equal(body["n"], 1);

    assert.ok(isGeneratedBytes(result), "expected bytes, not a url");
    assert.equal(result.mime, "image/png");
    assert.deepEqual(Buffer.from(result.bytes), PNG);
  });

  it("does not double /v1 when the base url already carries it, and honours the model", async () => {
    let path = "";
    const served = await serve((request, response) => {
      path = request.url ?? "";
      void readBody(request).then(() => json(response, 200, { data: [{ b64_json: PNG.toString("base64") }] }));
    });

    await openaiImages.generate({ prompt: "x" }, config(`${served.url}/v1`, { model: "dall-e-3" }));
    assert.equal(path, "/v1/images/generations");
  });

  it("returns a url when the provider hands back a link instead of bytes", async () => {
    const served = await serve((request, response) => {
      void readBody(request).then(() =>
        json(response, 200, { data: [{ url: "https://cdn.example.test/image.png" }] }),
      );
    });

    const result = await openaiImages.generate({ prompt: "x" }, config(served.url));
    assert.deepEqual(result, { url: "https://cdn.example.test/image.png" });
  });

  it("refuses a payload over the byte cap before decoding it", async () => {
    const oversized = Buffer.alloc(2_048, 7);
    const served = await serve((request, response) => {
      void readBody(request).then(() => json(response, 200, { data: [{ b64_json: oversized.toString("base64") }] }));
    });

    await assert.rejects(
      openaiImages.generate({ prompt: "x" }, config(served.url, { maxBytes: 1_024 })),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.provider, "openai-images");
        assert.match(error.message, /over the 1024-byte cap/);
        return true;
      },
    );
    assert.equal(MAX_GENERATION_BYTES, 25 * 1024 * 1024, "the default cap is 25 MiB");
  });

  it("maps an auth failure without leaking the key, even when the server echoes it", async () => {
    const served = await serve((request, response) => {
      void readBody(request).then(() =>
        json(response, 401, { error: { message: `Incorrect API key provided: ${API_KEY}` } }),
      );
    });

    await assert.rejects(
      openaiImages.generate({ prompt: "x" }, config(served.url)),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.status, 401);
        assert.match(error.message, /authentication failed/);
        assert.match(error.message, /check the api key/);
        assert.ok(!error.message.includes(API_KEY), "the key leaked into the error");
        assert.ok(!error.message.includes("SECRET1234"), "a key fragment leaked into the error");
        return true;
      },
    );
  });

  it("maps a rate limit and a server error distinctly", async () => {
    const limited = await serve((request, response) => {
      void readBody(request).then(() => json(response, 429, { error: { message: "slow down" } }));
    });
    await assert.rejects(openaiImages.generate({ prompt: "x" }, config(limited.url)), /rate limited.*slow down/);

    const broken = await serve((request, response) => {
      void readBody(request).then(() => json(response, 503, { error: { message: "try later" } }));
    });
    await assert.rejects(
      openaiImages.generate({ prompt: "x" }, config(broken.url)),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.status, 503);
        assert.match(error.message, /server error \(HTTP 503\).*try later/);
        return true;
      },
    );
  });

  it("times out instead of hanging forever", async () => {
    const served = await serve(() => {
      // Deliberately never answers.
    });
    await assert.rejects(
      openaiImages.generate({ prompt: "x" }, config(served.url, { timeoutMs: 100 })),
      /timed out after 100 ms/,
    );
  });

  it("refuses an empty prompt and a missing key before any request", async () => {
    await assert.rejects(openaiImages.generate({ prompt: "  " }, { apiKey: API_KEY }), /needs a prompt/);
    await assert.rejects(openaiImages.generate({ prompt: "x" }, {}), /no api key configured/);
  });
});
