import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, describe, it } from "node:test";
import { GenerationError, isGeneratedBytes, type GenerationConfig } from "../../types.js";
import { comfyui } from "./index.js";

/** A real 1x1 PNG, served from /view the way ComfyUI serves output files. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PROMPT_ID = "p-1";
const WORKFLOW = {
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4, model: ["4", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
};

interface Fixture {
  readonly url: string;
  close(): Promise<void>;
}

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
  baseUrl,
  workflow: WORKFLOW,
  pollIntervalMs: 10,
  ...extra,
});

describe("comfyui provider", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const close of cleanups) await close();
  });

  async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Fixture> {
    const served = await fixture(handler);
    cleanups.push(served.close);
    return served;
  }

  it("is unavailable without a url", () => {
    assert.equal(comfyui.isAvailable({}), false);
    assert.equal(comfyui.isAvailable({ baseUrl: "  " }), false);
    assert.equal(comfyui.isAvailable({ baseUrl: "http://127.0.0.1:8188" }), true);
  });

  it("submits the configured workflow, polls history, and lands the image as bytes", async () => {
    let submitted: Record<string, unknown> | null = null;
    let polls = 0;
    let viewQuery = "";
    const served = await serve((request, response) => {
      if (request.method === "POST" && request.url === "/prompt") {
        void readBody(request).then((body) => {
          submitted = JSON.parse(body) as Record<string, unknown>;
          json(response, 200, { prompt_id: PROMPT_ID, number: 1 });
        });
        return;
      }
      if (request.method === "GET" && request.url === `/history/${PROMPT_ID}`) {
        polls += 1;
        // ComfyUI answers `{}` until the run is done.
        if (polls === 1) json(response, 200, {});
        else {
          json(response, 200, {
            [PROMPT_ID]: {
              status: { status_str: "success", completed: true, messages: [] },
              outputs: { "9": { images: [{ filename: "out_0001.png", subfolder: "", type: "output" }] } },
            },
          });
        }
        return;
      }
      if (request.method === "GET" && (request.url ?? "").startsWith("/view?")) {
        viewQuery = request.url ?? "";
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(PNG);
        return;
      }
      response.writeHead(404).end();
    });

    const result = await comfyui.generate({ prompt: "ignored; the workflow carries it" }, config(served.url));

    assert.notEqual(submitted, null, "no workflow was submitted");
    assert.deepEqual(submitted?.["prompt"], WORKFLOW);
    assert.equal(typeof submitted?.["client_id"], "string");
    assert.ok((submitted?.["client_id"] as string).length > 0);
    assert.ok(polls >= 2, `history was polled ${String(polls)} time(s)`);

    const query = new URLSearchParams(viewQuery.split("?")[1] ?? "");
    assert.equal(query.get("filename"), "out_0001.png");
    assert.equal(query.get("type"), "output");

    assert.ok(isGeneratedBytes(result), "expected bytes, not a url");
    assert.equal(result.mime, "image/png");
    assert.deepEqual(Buffer.from(result.bytes), PNG);
  });

  it("reports a rejected workflow with the server's own words, node errors included", async () => {
    const served = await serve((request, response) => {
      if (request.method === "POST" && request.url === "/prompt") {
        void readBody(request).then(() =>
          json(response, 400, {
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
            node_errors: { "3": { errors: [{ message: "Value not in list: ckpt_name" }] } },
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });

    await assert.rejects(
      comfyui.generate({ prompt: "x" }, config(served.url)),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.provider, "comfyui");
        assert.equal(error.status, 400);
        assert.match(error.message, /workflow rejected/);
        assert.match(error.message, /Prompt outputs failed validation/);
        assert.match(error.message, /node 3: Value not in list/);
        return true;
      },
    );
  });

  it("says the run failed when history reports an execution error", async () => {
    const served = await serve((request, response) => {
      if (request.method === "POST" && request.url === "/prompt") {
        void readBody(request).then(() => json(response, 200, { prompt_id: PROMPT_ID }));
        return;
      }
      json(response, 200, {
        [PROMPT_ID]: {
          status: {
            status_str: "error",
            completed: false,
            messages: [
              ["execution_start", { prompt_id: PROMPT_ID }],
              ["execution_error", { node_id: "3", node_type: "KSampler", exception_message: "CUDA out of memory" }],
            ],
          },
        },
      });
    });

    await assert.rejects(
      comfyui.generate({ prompt: "x" }, config(served.url)),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.match(error.message, /workflow failed/);
        assert.match(error.message, /3: CUDA out of memory/);
        return true;
      },
    );
  });

  it("times out while history never finishes instead of returning an empty image", async () => {
    const served = await serve((request, response) => {
      if (request.method === "POST" && request.url === "/prompt") {
        void readBody(request).then(() => json(response, 200, { prompt_id: PROMPT_ID }));
        return;
      }
      json(response, 200, {});
    });

    await assert.rejects(
      comfyui.generate({ prompt: "x" }, config(served.url, { timeoutMs: 200 })),
      /timed out after 200 ms/,
    );
  });

  it("refuses a missing url or workflow before asking the network", async () => {
    await assert.rejects(comfyui.generate({ prompt: "x" }, {}), /no url configured/);
    await assert.rejects(comfyui.generate({ prompt: "x" }, { baseUrl: "http://127.0.0.1:9" }), /no workflow configured/);
  });
});
