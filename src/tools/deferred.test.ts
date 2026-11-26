import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { ToolContext } from "../types.js";
import {
  deferTool,
  isDeferred,
  listDeferred,
  resetDeferredTools,
  resolveSchema,
  resolveTool,
  toToolDescriptor,
} from "./deferred.js";

/**
 * A deferred tool is a promise: the model sees a name and one line, and the
 * schema only exists once someone asks for it by name. These tests pin both
 * halves — the stub carries nothing heavy, and the resolution is exact or
 * refuses out loud.
 */

const CTX: ToolContext = { cwd: "/tmp" };

const SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string", description: "the whole new file" },
  },
  required: ["path", "content"],
} as const;

function register(): ReturnType<typeof deferTool> {
  return deferTool({
    name: "write_file",
    summary: "Write a file to disk; replaces it whole.",
    description: "Writes the given content to the given path, creating parents.",
    parameters: SCHEMA,
    run: async (args) => `wrote ${String(args["path"])}`,
  });
}

describe("deferred tools", () => {
  beforeEach(() => {
    resetDeferredTools();
  });

  it("hides the parameters until they are resolved", () => {
    const stub = register();

    assert.deepEqual(stub, {
      name: "write_file",
      summary: "Write a file to disk; replaces it whole.",
      deferred: true,
    });
    assert.equal("parameters" in stub, false);

    const descriptor = toToolDescriptor(stub);
    assert.deepEqual(descriptor, {
      type: "function",
      function: { name: "write_file", description: "Write a file to disk; replaces it whole." },
    });
    assert.equal(JSON.stringify(descriptor).includes("\"parameters\""), false);

    const resolved = resolveSchema("write_file");
    assert.deepEqual(resolved.parameters, SCHEMA);
    assert.equal(resolved.description, "Writes the given content to the given path, creating parents.");
  });

  it("hands out the runnable tool only on request", async () => {
    register();
    const tool = resolveTool("write_file");

    assert.equal(tool.name, "write_file");
    assert.deepEqual(tool.parameters, SCHEMA);
    assert.equal(await tool.run({ path: "/tmp/x", content: "hi" }, CTX), "wrote /tmp/x");
  });

  it("errors honestly on an unknown name", () => {
    register();

    assert.throws(() => resolveSchema("read_file"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /unknown deferred tool: "read_file"/);
      // The message names what does exist, so a typo is fixable from the error.
      assert.match(error.message, /write_file/);
      return true;
    });
    assert.throws(() => resolveTool("read_file"), /unknown deferred tool: "read_file"/);
    assert.throws(
      () => toToolDescriptor({ name: "read_file", summary: "nope", deferred: true }),
      /unknown deferred tool: "read_file"/,
    );
    assert.equal(isDeferred("read_file"), false);
  });

  it("says nothing is deferred when the registry is empty", () => {
    assert.deepEqual(listDeferred(), []);
    assert.throws(() => resolveSchema("write_file"), /unknown deferred tool: "write_file" \(deferred: none\)/);
  });

  it("refuses a duplicate name instead of shadowing the first", () => {
    register();
    assert.throws(() => register(), /deferred tool "write_file" is already registered/);
    assert.equal(listDeferred().length, 1);
  });

  it("refuses a definition without a name, summary or schema", () => {
    const run = async (): Promise<string> => "ok";
    assert.throws(
      () => deferTool({ name: "  ", summary: "x", parameters: { type: "object" }, run }),
      /needs a name/,
    );
    assert.throws(
      () => deferTool({ name: "t", summary: " ", parameters: { type: "object" }, run }),
      /needs a summary/,
    );
    assert.throws(
      () => deferTool({ name: "t", summary: "s", parameters: null as unknown as Record<string, unknown>, run }),
      /needs a parameters object/,
    );
  });

  it("keeps the registered schema even if the caller mutates its object", () => {
    const parameters: Record<string, unknown> = { type: "object", properties: {} };
    const stub = deferTool({ name: "mutable", summary: "s", parameters, run: async () => "ok" });
    parameters["type"] = "string";

    assert.equal(resolveSchema(stub.name).parameters["type"], "object");
    assert.equal(isDeferred("mutable"), true);
  });
});
