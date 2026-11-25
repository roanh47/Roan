import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tool } from "../types.js";
import { MutableToolRegistry, buildRegistry } from "./registry.js";
import type { Policy } from "./policy.js";

function tool(name: string): Tool {
  return { name, description: name, parameters: { type: "object", properties: {} }, run: async () => "ok" };
}

const EMPTY: Policy = { tools: {}, workspace: "/tmp" };

test("a registered tool is available, and later registrations win", () => {
  const registry = new MutableToolRegistry(EMPTY);
  registry.register(tool("read_file"), { set: "core" });
  assert.equal(registry.has("read_file"), true);
  assert.equal(registry.all().length, 1);

  const replacement = tool("read_file");
  registry.register(replacement, { set: "plugin-x", source: "plugin" });
  assert.equal(registry.all().length, 1);
  assert.equal(registry.get("read_file"), replacement);
});

test("the policy decides core tools; a deny removes it from the surface", () => {
  const policy: Policy = { tools: { write_file: "deny", run_shell: "ask" }, workspace: "/tmp" };
  const registry = new MutableToolRegistry(policy);
  registry.register(tool("write_file"), { set: "core" });
  registry.register(tool("run_shell"), { set: "core" });
  registry.register(tool("read_file"), { set: "core" });

  assert.equal(registry.has("write_file"), false);
  assert.deepEqual(registry.allowed().map((entry) => entry.name).sort(), ["read_file", "run_shell"]);
  assert.deepEqual(registry.needsApproval().map((entry) => entry.name), ["run_shell"]);
});

test("unlisted tools are allowed; only an explicit decision gates one", () => {
  const registry = new MutableToolRegistry(EMPTY);
  registry.register(tool("web_search"), { set: "web", source: "plugin" });
  registry.register(tool("run_shell"), { set: "core", source: "core" });

  assert.equal(registry.has("web_search"), true);
  assert.equal(registry.has("run_shell"), true);
});

test("registration bumps the generation counter", () => {
  const registry = new MutableToolRegistry(EMPTY);
  const before = registry.registryGeneration();
  registry.register(tool("read_file"));
  assert.equal(registry.registryGeneration(), before + 1);
});

test("buildRegistry keeps its old contract and rejects duplicate names", () => {
  assert.throws(() => buildRegistry([tool("read_file"), tool("read_file")], EMPTY), /duplicate tool name/);
  const registry = buildRegistry([tool("read_file"), tool("run_shell")], { tools: { run_shell: "ask" }, workspace: "/tmp" });
  assert.deepEqual(registry.needsApproval().map((entry) => entry.name), ["run_shell"]);
  assert.equal(registry.get("run_shell")?.name, "run_shell");
});
