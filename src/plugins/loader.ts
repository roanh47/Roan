import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginContext, PluginReport, RoanPlugin } from "./context.js";
import { toolSurface } from "../tools/surface.js";
import { webRegistry } from "../web/runtime.js";
import { webPlugin } from "./web/index.js";

/**
 * The registrar table: one row per PluginContext method, each pointing at the
 * registry it feeds. Hermes generates its context the same way, so a new
 * capability is a new row — the loader never grows a condition per capability.
 */
const REGISTRARS: ReadonlyArray<{ method: keyof PluginContext; bind: (value: never, pluginId: string) => void }> = [
  {
    method: "registerTool",
    bind: (tool, pluginId) => toolSurface.register(tool, { source: "plugin", set: pluginId }),
  },
  {
    method: "registerWebProvider",
    bind: (provider) => webRegistry.register(provider),
  },
] as ReadonlyArray<{ method: keyof PluginContext; bind: (value: never, pluginId: string) => void }>;

function contextFor(pluginId: string): PluginContext {
  const ctx = {} as PluginContext;
  for (const row of REGISTRARS) {
    (ctx as unknown as Record<string, (value: unknown) => void>)[row.method] = (value: unknown) =>
      (row.bind as unknown as (v: unknown, id: string) => void)(value, pluginId);
  }
  return ctx;
}

/** The plugins compiled into this build, in load order. */
const BUNDLED: readonly RoanPlugin[] = [webPlugin];

export interface PluginManifest {
  readonly id?: unknown;
  readonly kind?: unknown;
  /** Where the module lives, relative to the plugin dir. */
  readonly entry?: unknown;
}

/** Loads one plugin and reports what happened; a broken plugin never kills boot. */
function loadOne(plugin: RoanPlugin, source: "bundled" | "home"): PluginReport {
  try {
    plugin.register(contextFor(plugin.id));
    return { id: plugin.id, kind: plugin.kind ?? "general", source, ok: true };
  } catch (error) {
    return {
      id: plugin.id,
      kind: plugin.kind ?? "general",
      source,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const reports: PluginReport[] = [];
let bundledLoaded = false;

/** Registers the bundled plugins once. */
export function ensureBundledPlugins(): void {
  if (bundledLoaded) return;
  bundledLoaded = true;
  for (const plugin of BUNDLED) reports.push(loadOne(plugin, "bundled"));
}

/**
 * Loads plugins from `<home>/plugins/<name>/plugin.json` (+ the module it
 * names), after the bundled ones: a home plugin with the same id replaces the
 * bundled tool registrations, exactly like Hermes's later-wins rule.
 */
export async function loadHomePlugins(home: string): Promise<PluginReport[]> {
  ensureBundledPlugins();
  const root = join(home, "plugins");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return reports;
  }
  for (const entry of entries.sort()) {
    const dir = join(root, entry);
    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "plugin.json"), "utf8")) as PluginManifest;
    } catch {
      continue; // a directory without a manifest is not a plugin
    }
    const id = typeof manifest.id === "string" && manifest.id.trim().length > 0 ? manifest.id.trim() : entry;
    const kind = typeof manifest.kind === "string" ? manifest.kind : "general";
    const moduleName = typeof manifest.entry === "string" && manifest.entry.trim().length > 0 ? manifest.entry.trim() : "index.js";
    try {
      const module = (await import(pathToFileURL(join(dir, moduleName)).href)) as { default?: RoanPlugin; register?: RoanPlugin["register"] };
      const plugin: RoanPlugin =
        module.default !== undefined
          ? module.default
          : { id, kind, register: (ctx) => (module.register as RoanPlugin["register"])(ctx) };
      reports.push(loadOne({ ...plugin, id, kind }, "home"));
    } catch (error) {
      reports.push({ id, kind, source: "home", ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return reports;
}

export function pluginReports(): readonly PluginReport[] {
  return reports;
}
