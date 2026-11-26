import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { MAX_AUDIO_BYTES, transcribeWith } from "../../provider.js";
import type { SpeechAudio, SttConfig } from "../../provider.js";
import { openAiCompat, transcriptionUrl, TRANSCRIBE_TIMEOUT_MS } from "./index.js";

/**
 * No network beyond loopback: every case runs against a server this file owns
 * on 127.0.0.1, so the test proves the request shape instead of trusting it.
 */

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface Reply {
  status: number;
  body: string;
  type?: string;
}

const AUDIO_BYTES = new Uint8Array(Buffer.from("RIFF-fake-audio-bytes", "latin1"));

function clip(bytes: Uint8Array = AUDIO_BYTES, mime = "audio/webm"): SpeechAudio {
  return { mime, bytes };
}

async function withServer(
  reply: (seen: Seen) => Reply,
  run: (baseUrl: string, seen: Seen[]) => Promise<void>,
): Promise<void> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry: Seen = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("latin1"),
      };
      seen.push(entry);
      const answer = reply(entry);
      response.writeHead(answer.status, { "content-type": answer.type ?? "application/json" });
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

function config(baseUrl: string, extra: Partial<SttConfig> = {}): SttConfig {
  return { baseUrl, model: "whisper-1", ...extra };
}

describe("the openai-compatible stt provider", () => {
  it("is only available with a url and a model, and never touches the network for that", () => {
    assert.equal(openAiCompat.isAvailable({}), false);
    assert.equal(openAiCompat.isAvailable({ baseUrl: "http://127.0.0.1:8080" }), false);
    assert.equal(openAiCompat.isAvailable({ model: "whisper-1" }), false);
    assert.equal(openAiCompat.isAvailable({ baseUrl: "  ", model: " " }), false);
    assert.equal(openAiCompat.isAvailable(config("http://127.0.0.1:8080")), true);
  });

  it("posts multipart/form-data with the file, the model and the bearer key", async () => {
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ text: "hallo wereld" }) }),
      async (baseUrl, seen) => {
        const text = await transcribeWith(openAiCompat, clip(), config(baseUrl, { apiKey: "geheim-lokaal" }));
        assert.equal(text, "hallo wereld");

        const request = seen[0];
        assert.ok(request !== undefined);
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/v1/audio/transcriptions");
        assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
        assert.equal(request.headers["authorization"], "Bearer geheim-lokaal");
        // The field names and the file part are the OpenAI contract itself.
        assert.match(request.body, /name="file"; filename="clip\.webm"/);
        assert.match(request.body, /content-type: audio\/webm/i);
        assert.ok(request.body.includes("RIFF-fake-audio-bytes"));
        assert.match(request.body, /name="model"[\s\S]*whisper-1/);
        assert.match(request.body, /name="response_format"[\s\S]*json/);
      },
    );
  });

  it("does not double /v1 and sends no auth header without a key", async () => {
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ text: "zonder sleutel" }) }),
      async (baseUrl, seen) => {
        assert.equal(await transcribeWith(openAiCompat, clip(), config(`${baseUrl}/v1/`)), "zonder sleutel");
        const request = seen[0];
        assert.ok(request !== undefined);
        assert.equal(request.url, "/v1/audio/transcriptions");
        assert.equal(request.headers["authorization"], undefined);
      },
    );
  });

  it("builds the transcription url from either base form", () => {
    assert.equal(transcriptionUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/audio/transcriptions");
    assert.equal(transcriptionUrl("http://127.0.0.1:8080/"), "http://127.0.0.1:8080/v1/audio/transcriptions");
    assert.equal(
      transcriptionUrl("http://127.0.0.1:8080/v1"),
      "http://127.0.0.1:8080/v1/audio/transcriptions",
    );
    assert.equal(
      transcriptionUrl("http://127.0.0.1:8080/openai/v1/"),
      "http://127.0.0.1:8080/openai/v1/audio/transcriptions",
    );
  });

  it("maps 401 to an api-key sentence and never echoes the key", async () => {
    await withServer(
      () => ({ status: 401, body: JSON.stringify({ error: { message: "invalid token" } }) }),
      async (baseUrl) => {
        await assert.rejects(
          transcribeWith(openAiCompat, clip(), config(baseUrl, { apiKey: "geheim-lokaal" })),
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

  it("maps 404 to a base-url hint and 413 to a size sentence", async () => {
    await withServer(
      () => ({ status: 404, body: "not found" }),
      async (baseUrl) => {
        await assert.rejects(transcribeWith(openAiCompat, clip(), config(baseUrl)), /HTTP 404\) — check the base url/);
      },
    );
    await withServer(
      () => ({ status: 413, body: "too much audio" }),
      async (baseUrl) => {
        await assert.rejects(transcribeWith(openAiCompat, clip(), config(baseUrl)), /too large for the server \(HTTP 413\)/);
      },
    );
  });

  it("maps a server failure to a readable message with the server's words", async () => {
    await withServer(
      () => ({ status: 500, body: "model whisper-1 not loaded" }),
      async (baseUrl) => {
        await assert.rejects(
          transcribeWith(openAiCompat, clip(), config(baseUrl)),
          /the transcription server failed \(HTTP 500\): model whisper-1 not loaded/,
        );
      },
    );
  });

  it("refuses an answer that is not the { text } shape", async () => {
    await withServer(
      () => ({ status: 200, body: "plain text, not json" }),
      async (baseUrl) => {
        await assert.rejects(
          transcribeWith(openAiCompat, clip(), config(baseUrl)),
          /answered with something that is not JSON/,
        );
      },
    );
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ result: "hallo" }) }),
      async (baseUrl) => {
        await assert.rejects(
          transcribeWith(openAiCompat, clip(), config(baseUrl)),
          /answered without a "text" field/,
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
    await assert.rejects(transcribeWith(openAiCompat, clip(), config(baseUrl)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cannot reach http:\/\/127\.0\.0\.1:\d+\/v1\/audio\/transcriptions/);
      assert.match(error.message, /is the transcription server running\?/);
      return true;
    });
  });

  it("honours the upload cap before building a request", async () => {
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ text: "nooit" }) }),
      async (baseUrl, seen) => {
        await assert.rejects(
          transcribeWith(openAiCompat, clip(new Uint8Array(MAX_AUDIO_BYTES + 1)), config(baseUrl)),
          /the recording is 25\.0 MB/,
        );
        assert.equal(seen.length, 0);
      },
    );
  });

  it("keeps a bounded timeout instead of hanging forever", () => {
    assert.ok(TRANSCRIBE_TIMEOUT_MS > 0 && TRANSCRIBE_TIMEOUT_MS <= 120_000);
  });
});
