import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoanPaths } from "./paths.js";
import { isEffortLevel, type EffortLevel } from "../providers/effort.js";
import { loadSettings, type Settings } from "./settings.js";

/**
 * Keys the app may write. Kept next to the type, not derived from the file on
 * disk: an unknown key in the app's payload is a bug in the app, and writing it
 * through would make the config file describe settings nothing reads.
 */
const SETTINGS_KEYS = [
  "baseUrl",
  "model",
  "apiKey",
  "provider",
  "effort",
  "access",
] as const satisfies readonly (keyof Settings)[];

type SettingsKey = (typeof SETTINGS_KEYS)[number];

/**
 * A patch of settings the app sent over the local socket. Untrusted. `access`
 * is the one nested value: a capability flag, never a string, and never
 * anything but the exact boolean `true` to turn it on.
 */
export interface SettingsPatch {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  provider?: string;
  effort?: EffortLevel;
  access?: { fullDisk?: boolean };
}

function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key);
}

function parseAccessPatch(input: unknown): { fullDisk?: boolean } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("setting access must be an object");
  }
  const access: { fullDisk?: boolean } = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key !== "fullDisk") {
      throw new Error(`unknown access setting: ${key}`);
    }
    if (typeof value !== "boolean") {
      const kind = value === null ? "null" : typeof value;
      throw new Error(`access.fullDisk must be a boolean, got ${kind}`);
    }
    access.fullDisk = value;
  }
  return access;
}

/**
 * Validate an untrusted patch. Values are checked by type only and never echoed
 * back in an error: one of these keys holds an API key, and a leaked key in a
 * log line is a leaked key. `effort` is the one value with a closed set; a
 * string the adapter would not understand must not reach a request body.
 */
function parsePatch(input: unknown): SettingsPatch {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    const kind = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
    throw new Error(`settings patch must be an object, got ${kind}`);
  }

  const patch: SettingsPatch = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isSettingsKey(key)) {
      throw new Error(`unknown setting: ${key}`);
    }
    if (key === "access") {
      patch.access = parseAccessPatch(value);
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`setting ${key} must be a string, got ${value === null ? "null" : typeof value}`);
    }
    if (key === "effort") {
      if (!isEffortLevel(value)) throw new Error("effort must be low, normal or high");
      patch.effort = value;
      continue;
    }
    switch (key) {
      case "baseUrl":
        patch.baseUrl = value;
        break;
      case "model":
        patch.model = value;
        break;
      case "apiKey":
        patch.apiKey = value;
        break;
      case "provider":
        patch.provider = value;
        break;
    }
  }
  return patch;
}

function tempPathFor(file: string): string {
  return `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
}

/**
 * Write `contents` to `file` so a reader sees either the old file or the new
 * one, never a half-written one: write a temp file in the same directory,
 * fsync it, then rename over the target. The temp file is created 0600 and the
 * target is chmod'ed after the rename, so the config is never world-readable.
 */
async function writeAtomically(file: string, contents: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });

  const temp = tempPathFor(file);
  const handle = await open(temp, "wx", 0o600);
  let renamed = false;
  try {
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    renamed = true;
  } finally {
    if (!renamed) {
      await unlink(temp).catch(() => undefined);
    }
  }

  await chmod(file, 0o600);
}

/**
 * Merge a validated patch onto the settings currently on disk and write the
 * result atomically. Returns what was written, so the caller can answer the app
 * without re-reading the file.
 */
export async function saveSettings(paths: RoanPaths, input: unknown): Promise<Settings> {
  const patch = parsePatch(input);
  const current = await loadSettings(paths);
  const { access: accessPatch, ...flat } = patch;
  const next: Settings = {
    ...current,
    ...flat,
    // A patch may carry only one access flag; merge instead of replacing the
    // whole object so a later capability does not reset an earlier one.
    access: { fullDisk: accessPatch?.fullDisk ?? current.access.fullDisk },
  };

  // Reads happen above; the write itself is one atomic step.
  await writeAtomically(paths.configFile, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
