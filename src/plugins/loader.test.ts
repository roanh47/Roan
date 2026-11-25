import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadHomePlugins, pluginReports } from "./loader.js";
import { loadPlugins } from "./index.js";
import { toolSurface } from "../tools/surface.js";
import { webRegistry } from "../web/runtime.js";

test("the bundled web plugin brings both halves: tools and providers", async () => {
  await loadPlugins();
  assert.ok(toolSurface.has("web_search"));
  assert.ok(toolSurface.has("web_fetch"));
  assert.ok(webRegistry.get("bing-rss") !== undefined);
  assert.ok(webRegistry.get("searxng") !== undefined);
  assert.ok(webRegistry.get("page") !== undefined);
});

test("a plugin dropped into the home registers its tool", async () => {
  const home = await mkdtemp(join(tmpdir(), "roan-plugin-"));
  try {
    const dir = join(home, "plugins", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "plugin.json"),
      JSON.stringify({ id: "demo", kind: "tools", entry: "index.js" }),
    );
    await writeFile(
      join(dir, "index.js"),
      `export function register(ctx) {
         ctx.registerTool({
           name: "demo_tool",
           description: "a tool from a home plugin",
           parameters: { type: "object", properties: {} },
           run: async () => "demo",
         });
       }`,
    );
    const reports = await loadHomePlugins(home);
    const demo = reports.find((report) => report.id === "demo");
    assert.ok(demo !== undefined);
    assert.equal(demo?.ok, true);
    assert.equal(demo?.source, "home");
    assert.ok(toolSurface.has("demo_tool"));
    assert.equal(await toolSurface.get("demo_tool")?.run({}, { cwd: home }), "demo");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a broken plugin is reported and skipped; the surface stays intact", async () => {
  const home = await mkdtemp(join(tmpdir(), "roan-plugin-"));
  try {
    const dir = join(home, "plugins", "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "plugin.json"), JSON.stringify({ id: "broken", entry: "index.js" }));
    await writeFile(join(dir, "index.js"), `export function register() { throw new Error("boom"); }`);
    const reports = await loadHomePlugins(home);
    const broken = reports.find((report) => report.id === "broken");
    assert.equal(broken?.ok, false);
    assert.match(String(broken?.error), /boom/);
    assert.ok(toolSurface.has("web_search"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a directory without a manifest is not a plugin", async () => {
  const home = await mkdtemp(join(tmpdir(), "roan-plugin-"));
  try {
    await mkdir(join(home, "plugins", "just-a-folder"), { recursive: true });
    const before = pluginReports().length;
    const reports = await loadHomePlugins(home);
    assert.equal(reports.length, before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
