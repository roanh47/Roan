import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoanPaths } from "./paths.js";
import { loadSettings, type Settings } from "./settings.js";

/**
 * Keys the app may write. Kept next to the type, not derived from the file on
 * disk: an unknown key in the app's payload is a bug in the app, and writing it
 * through would make the config file describe settings nothing reads.
 */
const SETTINGS_KEYS = ["baseUrl", "model", "apiKey", "provider"] as const satisfies readonly (keyof Settings)[];

type SettingsKey = (typeof SETTINGS_KEYS)[number];

/** A patch of settings the app sent over the local socket. Untrusted. */
export type SettingsPatch = Partial<Record<SettingsKey, string>>;

function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key);
}

/**
 * Validate an untrusted patch. Values are checked by type only and never echoed
 * back in an error: one of these keys holds an API key, and a leaked key in a
 * log line is a leaked key.
 */
function parsePatch(input: unknown): SettingsPatch {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    const kind = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
    throw new Error(`settings patch must be an object, got ${kind}`);
  }

  const patch: Partial<Record<SettingsKey, string>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isSettingsKey(key)) {
      throw new Error(`unknown setting: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`setting ${key} must be a string, got ${value === null ? "null" : typeof value}`);
    }
    patch[key] = value;
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
  const next: Settings = { ...current, ...patch };

  // Reads happen above; the write itself is one atomic step.
  await writeAtomically(paths.configFile, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
