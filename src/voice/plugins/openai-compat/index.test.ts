import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { speakWith } from "../../tts.js";
import type { TtsConfig } from "../../tts.js";
import { MAX_SPEECH_BYTES, MAX_SPEECH_CHARS } from "../../tts.js";
import { openAiCompat, speechUrl, TTS_TIMEOUT_MS } from "./index.js";

/**
 * No network beyond loopback: every case runs against a server this file owns
 * on 127.0.0.1, so the test proves the request and the answer shape instead of
 * trusting them.
 */

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface Reply {
  status: number;
  body: Uint8Array | string;
  type?: string;
  headers?: Record<string, string>;
}

const AUDIO_BYTES = new Uint8Array(Buffer.from("ID3-fake-mp3-bytes", "latin1"));

async function withServer(
  reply: (seen: Seen) => Reply,
  run: (baseUrl: string, seen: Seen[]) => Promise<void>,
): Promise<void> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry: Seen = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(entry);
      const answer = reply(entry);
      response.writeHead(answer.status, {
        "content-type": answer.type ?? "audio/mpeg",
        ...answer.headers,
      });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${String(address.port)}`, seen);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function config(baseUrl: string, extra: Partial<TtsConfig> = {}): TtsConfig {
  return { baseUrl, model: "tts-1", ...extra };
}

describe("the openai-compatible tts provider", () => {
  it("is only available with a url and a model, and never touches the network for that", () => {
    assert.equal(openAiCompat.isAvailable({}), false);
    assert.equal(openAiCompat.isAvailable({ baseUrl: "http://127.0.0.1:8080" }), false);
    assert.equal(openAiCompat.isAvailable({ model: "tts-1" }), false);
    assert.equal(openAiCompat.isAvailable({ baseUrl: "  ", model: " " }), false);
    assert.equal(openAiCompat.isAvailable(config("http://127.0.0.1:8080")), true);
  });

  it("posts the OpenAI speech body and returns the audio bytes", async () => {
    await withServer(
      () => ({ status: 200, body: AUDIO_BYTES }),
      async (baseUrl, seen) => {
        const audio = await speakWith(
          openAiCompat,
          "  hallo wereld  ",
          config(baseUrl, { apiKey: "geheim-lokaal", voice: "nova", format: "wav" }),
        );
        assert.equal(audio.mime, "audio/mpeg");
        assert.deepEqual(audio.bytes, AUDIO_BYTES);

        const request = seen[0];
        assert.ok(request !== undefined);
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/v1/audio/speech");
        assert.match(request.headers["content-type"] ?? "", /^application\/json/);
        assert.equal(request.headers["authorization"], "Bearer geheim-lokaal");

        const body = JSON.parse(request.body) as Record<string, unknown>;
        assert.deepEqual(body, {
          model: "tts-1",
          input: "hallo wereld",
          voice: "nova",
          response_format: "wav",
        });
      },
    );
  });

  it("defaults the voice and the format when the config does not name them", async () => {
    await withServer(
      () => ({ status: 200, body: AUDIO_BYTES }),
      async (baseUrl, seen) => {
        await speakWith(openAiCompat, "hoi", config(baseUrl));
        const request = seen[0];
        assert.ok(request !== undefined);
        const body = JSON.parse(request.body) as Record<string, unknown>;
        assert.equal(body["voice"], "alloy");
        assert.equal(body["response_format"], "mp3");
        assert.equal(request.headers["authorization"], undefined);
      },
    );
  });

  it("does not double /v1 and builds the speech url from either base form", async () => {
    assert.equal(speechUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/audio/speech");
    assert.equal(speechUrl("http://127.0.0.1:8080/"), "http://127.0.0.1:8080/v1/audio/speech");
    assert.equal(speechUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1/audio/speech");
    assert.equal(speechUrl("http://127.0.0.1:8080/openai/v1/"), "http://127.0.0.1:8080/openai/v1/audio/speech");

    await withServer(
      () => ({ status: 200, body: AUDIO_BYTES }),
      async (baseUrl, seen) => {
        await speakWith(openAiCompat, "hoi", config(`${baseUrl}/v1/`));
        assert.equal(seen[0]?.url, "/v1/audio/speech");
      },
    );
  });

  it("maps a bare octet-stream back to the format it asked for", async () => {
    await withServer(
      () => ({ status: 200, body: AUDIO_BYTES, type: "application/octet-stream" }),
      async (baseUrl) => {
        const audio = await speakWith(openAiCompat, "hoi", config(baseUrl, { format: "wav" }));
        assert.equal(audio.mime, "audio/wav");
      },
    );
  });

  it("maps 401 to an api-key sentence and never echoes the key", async () => {
    await withServer(
      () => ({ status: 401, body: JSON.stringify({ error: { message: "invalid token" } }), type: "application/json" }),
      async (baseUrl) => {
        await assert.rejects(
          speakWith(openAiCompat, "hoi", config(baseUrl, { apiKey: "geheim-lokaal" })),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /rejected the api key \(HTTP 401\)/);
            assert.ok(!error.message.includes("geheim-lokaal"), "the key must never appear in an error");
            return true;
          },
        );
      },
    );
  });

  it("maps 404 to a base-url hint, 413 to a length sentence and 5xx to the server's words", async () => {
    await withServer(
      () => ({ status: 404, body: "not found", type: "text/plain" }),
      async (baseUrl) => {
        await assert.rejects(speakWith(openAiCompat, "hoi", config(baseUrl)), /HTTP 404\) — check the base url/);
      },
    );
    await withServer(
      () => ({ status: 413, body: "too long", type: "text/plain" }),
      async (baseUrl) => {
        await assert.rejects(speakWith(openAiCompat, "hoi", config(baseUrl)), /too long for the server \(HTTP 413\)/);
      },
    );
    await withServer(
      () => ({ status: 500, body: "model tts-1 not loaded", type: "text/plain" }),
      async (baseUrl) => {
        await assert.rejects(
          speakWith(openAiCompat, "hoi", config(baseUrl)),
          /the speech server failed \(HTTP 500\): model tts-1 not loaded/,
        );
      },
    );
  });

  it("refuses a JSON answer instead of handing it to a player", async () => {
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ error: "no such voice" }), type: "application/json" }),
      async (baseUrl) => {
        await assert.rejects(speakWith(openAiCompat, "hoi", config(baseUrl)), /instead of audio/);
      },
    );
  });

  it("refuses an empty audio body", async () => {
    await withServer(
      () => ({ status: 200, body: new Uint8Array(0) }),
      async (baseUrl) => {
        await assert.rejects(speakWith(openAiCompat, "hoi", config(baseUrl)), /returned an empty audio body \(0 bytes\)/);
      },
    );
  });

  it("honours the text cap before a request is built", async () => {
    await withServer(
      () => ({ status: 200, body: AUDIO_BYTES }),
      async (baseUrl, seen) => {
        await assert.rejects(
          speakWith(openAiCompat, "a".repeat(MAX_SPEECH_CHARS + 1), config(baseUrl)),
          /the limit is 4096 — split it into shorter parts/,
        );
        assert.equal(seen.length, 0);
      },
    );
  });

  it("refuses audio the server announced as over the cap", async () => {
    await withServer(
      () => ({
        status: 200,
        body: new Uint8Array(0),
        headers: { "content-length": String(MAX_SPEECH_BYTES + 1) },
      }),
      async (baseUrl) => {
        await assert.rejects(
          speakWith(openAiCompat, "hoi", config(baseUrl)),
          /announced 25\.0 MB of audio; the limit is 25\.0 MB/,
        );
      },
    );
  });

  it("names the url when the server is not running", async () => {
    // Bind a port, close it, then aim at it: nothing listens there.
    const probe: Server = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));

    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    await assert.rejects(speakWith(openAiCompat, "hoi", config(baseUrl)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cannot reach http:\/\/127\.0\.0\.1:\d+\/v1\/audio\/speech/);
      assert.match(error.message, /is the speech server running\?/);
      return true;
    });
  });

  it("keeps a bounded timeout instead of hanging forever", () => {
    assert.ok(TTS_TIMEOUT_MS > 0 && TTS_TIMEOUT_MS <= 120_000);
  });
});
