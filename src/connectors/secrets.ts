/**
 * Connector tokens live in `secrets/`, never in the chain.
 *
 * The chain travels: every device adopts it, so anything inside it is on every
 * machine and in every backup. A GitHub token is per person and per machine, so
 * it stays in `~/.Roan/secrets/connectors/<name>.json` — the same directory,
 * and the same rule, as the node identity. This module reads that file and
 * refuses one the rest of the machine can read.
 *
 * Error messages name the file and the field. They never quote the value, and
 * the value is not returned on any failure path.
 */

import { readFile, stat } from "node:fs/promises";

/** Default field name inside a connector's JSON file. */
export const TOKEN_FIELD = "token";

export interface ReadTokenOptions {
  /** JSON field holding the token. Default `token`. */
  field?: string;
}

/**
 * Reads one token.
 *
 * On POSIX the file must be mode `0600`-or-stricter: a group- or
 * world-readable token file is treated as a misconfiguration, not a warning,
 * because by the time it is read the exposure has already happened. The check
 * is skipped on Windows, which has no POSIX bits to test.
 */
export async function readConnectorToken(
  path: string,
  options: ReadTokenOptions = {},
): Promise<string> {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("readConnectorToken: path must be a non-empty string");
  }
  const field = options.field ?? TOKEN_FIELD;

  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`readConnectorToken: cannot read ${path}`);
  }
  if (!info.isFile()) {
    throw new Error(`readConnectorToken: ${path} is not a regular file`);
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(
      `readConnectorToken: ${path} is readable by group or others; chmod 600 it`,
    );
  }

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`readConnectorToken: cannot read ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`readConnectorToken: ${path} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`readConnectorToken: ${path} must hold a JSON object`);
  }

  const value = (parsed as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`readConnectorToken: ${path} has no non-empty "${field}" string`);
  }
  return value;
}
