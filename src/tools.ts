import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Tool } from "./types.js";
import { ensureBundledPlugins } from "./plugins/index.js";
import { toolSurface } from "./tools/surface.js";
import { defineBrowserTool } from "./browser/provider.js";
import { defaultPolicy, pathAccessViolation } from "./tools/policy.js";

const execAsync = promisify(exec);

/**
 * Resolve a tool path against the working directory and let the policy decide.
 * With `access.fullDisk` on, the owner has said the agent works with the
 * daemon's own rights, so a path outside the workspace is allowed (the policy
 * still refuses device nodes, /proc memory and writes into /boot and /sys).
 * With it off, this is the old "inside the workspace only" refusal.
 */
function resolveInside(cwd: string, target: unknown, write = false): string {
  const raw = typeof target === "string" && target.length > 0 ? target : ".";
  const full = path.resolve(cwd, raw);
  const policy = defaultPolicy(cwd, { fullDisk: fullDiskAccess });
  const violation = pathAccessViolation(policy, full, write);
  if (violation !== null) throw new Error(violation);
  return full;
}

/** Set by the daemon from settings.access.fullDisk; read once per process. */
let fullDiskAccess = false;
export function setFullDiskAccess(enabled: boolean): void {
  fullDiskAccess = enabled;
}

export const readFile: Tool = {
  name: "read_file",
  description: "Read a text file and return its contents.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path, relative to the working directory" },
    },
    required: ["path"],
  },
  async run(args, ctx) {
    const target = resolveInside(ctx.cwd, args["path"]);
    const content = await fs.readFile(target, "utf8");
    return content.length > 40_000 ? content.slice(0, 40_000) + "\n…(truncated)" : content;
  },
};

export const writeFile: Tool = {
  name: "write_file",
  description: "Write a text file. Creates directories if they do not exist yet.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async run(args, ctx) {
    const target = resolveInside(ctx.cwd, args["path"]);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(args["content"] ?? ""), "utf8");
    const bytes = Buffer.byteLength(String(args["content"] ?? ""));
    return `written: ${path.relative(ctx.cwd, target)} (${bytes} bytes)`;
  },
};

export const listDir: Tool = {
  name: "list_dir",
  description: "List the files and directories in a directory.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Defaults to the working directory" },
    },
  },
  async run(args, ctx) {
    const target = resolveInside(ctx.cwd, args["path"] ?? ".");
    const entries = await fs.readdir(target, { withFileTypes: true });
    if (entries.length === 0) return "(empty)";
    return entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  },
};

export const runShell: Tool = {
  name: "run_shell",
  description:
    "Run a shell command in the working directory. Use this for git, tests, builds and inspecting files.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_seconds: { type: "number", description: "Default 60" },
    },
    required: ["command"],
  },
  async run(args, ctx) {
    const command = String(args["command"] ?? "").trim();
    if (!command) throw new Error("empty command");
    const timeout = Math.min(Math.max(Number(args["timeout_seconds"]) || 60, 1), 600) * 1000;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        shell: "/bin/bash",
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      return out === "" ? "(no output, exit 0)" : out;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      const out = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`exit ${e.code ?? "?"}\n${out || e.message || "unknown error"}`);
    }
  },
};

export const builtinTools: Tool[] = [readFile, writeFile, listDir, runShell];

for (const tool of builtinTools) toolSurface.register(tool, { set: "core", source: "core" });

// The browser is a core tool with an optional endpoint (BROWSER_CDP_URL):
// without one it refuses honestly instead of pretending to browse.
toolSurface.register(defineBrowserTool(), { set: "core", source: "core" });

/** Everything the model may call: core tools plus whatever plugins brought. */
export function allTools(): Tool[] {
  ensureBundledPlugins();
  return toolSurface.all();
}

export function toToolSpecs(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
