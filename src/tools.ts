import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Tool } from "./types.js";

const execAsync = promisify(exec);

/** Zet een pad om naar iets binnen de werkmap; weiger paden die erbuiten wijzen. */
function resolveInside(cwd: string, target: unknown): string {
  const raw = typeof target === "string" && target.length > 0 ? target : ".";
  const full = path.resolve(cwd, raw);
  const rel = path.relative(cwd, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`pad valt buiten de werkmap: ${raw}`);
  }
  return full;
}

export const readFile: Tool = {
  name: "read_file",
  description: "Lees een tekstbestand en geef de inhoud terug.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Pad, relatief aan de werkmap" },
    },
    required: ["path"],
  },
  async run(args, ctx) {
    const target = resolveInside(ctx.cwd, args["path"]);
    const content = await fs.readFile(target, "utf8");
    return content.length > 40_000 ? content.slice(0, 40_000) + "\n…(afgekapt)" : content;
  },
};

export const writeFile: Tool = {
  name: "write_file",
  description: "Schrijf een tekstbestand. Maakt mappen aan als ze nog niet bestaan.",
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
    return `geschreven: ${path.relative(ctx.cwd, target)} (${bytes} bytes)`;
  },
};

export const listDir: Tool = {
  name: "list_dir",
  description: "Toon de bestanden en mappen in een map.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Standaard de werkmap" },
    },
  },
  async run(args, ctx) {
    const target = resolveInside(ctx.cwd, args["path"] ?? ".");
    const entries = await fs.readdir(target, { withFileTypes: true });
    if (entries.length === 0) return "(leeg)";
    return entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  },
};

export const runShell: Tool = {
  name: "run_shell",
  description:
    "Voer een shell-commando uit in de werkmap. Gebruik dit voor git, tests, builds en het opvragen van bestanden.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_seconds: { type: "number", description: "Standaard 60" },
    },
    required: ["command"],
  },
  async run(args, ctx) {
    const command = String(args["command"] ?? "").trim();
    if (!command) throw new Error("leeg commando");
    const timeout = Math.min(Math.max(Number(args["timeout_seconds"]) || 60, 1), 600) * 1000;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        shell: "/bin/bash",
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      return out === "" ? "(geen uitvoer, exit 0)" : out;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      const out = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`exit ${e.code ?? "?"}\n${out || e.message || "onbekende fout"}`);
    }
  },
};

export const builtinTools: Tool[] = [readFile, writeFile, listDir, runShell];

export function toToolSpecs(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
