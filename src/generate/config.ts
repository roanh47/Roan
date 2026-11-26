import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GenerationConfig } from "./types.js";

/**
 * The generation section is non-secret and lives per machine in
 * `<home>/generate.json`: which provider to use per kind, the ComfyUI url and
 * workflow, and the model. The API key is *not* read from here — it comes from
 * `secrets/`, handed in by the daemon, and never travels in the chain.
 *
 *   { "imageBackend": "comfyui", "baseUrl": "http://127.0.0.1:8188",
 *     "workflow": { ... }, "model": "gpt-image-1" }
 */
export async function loadGenerateConfig(home: string, apiKey?: string): Promise<GenerationConfig> {
  let raw: string;
  try {
    raw = await readFile(join(home, "generate.json"), "utf8");
  } catch {
    return apiKey !== undefined && apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {};
  }

  const key = apiKey?.trim();
  const base: GenerationConfig = key !== undefined && key.length > 0 ? { apiKey: key } : {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (name: string): string | undefined => {
      const value = parsed[name];
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    };
    const pickNumber = (name: string): number | undefined => {
      const value = parsed[name];
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const workflow = parsed["workflow"];

    return {
      ...base,
      backend: pick("backend"),
      imageBackend: pick("imageBackend"),
      videoBackend: pick("videoBackend"),
      musicBackend: pick("musicBackend"),
      baseUrl: pick("baseUrl"),
      model: pick("model"),
      ...(typeof workflow === "object" && workflow !== null && !Array.isArray(workflow) ? { workflow } : {}),
      timeoutMs: pickNumber("timeoutMs"),
      pollIntervalMs: pickNumber("pollIntervalMs"),
      maxBytes: pickNumber("maxBytes"),
    };
  } catch {
    return base;
  }
}

let source: () => Promise<GenerationConfig> = async () => ({});

/** The daemon points this at the real config; tests and the CLI keep the empty one. */
export function setGenerateConfigSource(read: () => Promise<GenerationConfig>): void {
  source = read;
}

export function readGenerateConfig(): Promise<GenerationConfig> {
  return source();
}
