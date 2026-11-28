import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The owner's sign-in for a connection, kept on this device only.
 *
 * A connection (an MCP server) is chain config: its name and address travel,
 * so every device knows it exists. The token that proves who you are to that
 * service does not travel. It lives in `secrets/connections/<id>.json`, which
 * the env packer never reads, readable by this user alone. A device without
 * the token simply does not connect, and says so.
 *
 * A token is never returned to the app and never logged; the app only learns
 * whether one is set.
 */

/** A connection id is a plain name: it becomes a file name here. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isConnectionId(id: string): boolean {
  return ID.test(id);
}

function tokenFile(secretsDir: string, id: string): string {
  if (!isConnectionId(id)) throw new Error(`"${id}" is not a usable connection id`);
  return join(secretsDir, "connections", `${id}.json`);
}

/** The saved token, or null when there is none (or the file is unreadable). */
export async function loadConnectionToken(secretsDir: string, id: string): Promise<string | null> {
  if (!isConnectionId(id)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(tokenFile(secretsDir, id), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const token = (parsed as Record<string, unknown>)["token"];
    return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

export async function saveConnectionToken(secretsDir: string, id: string, token: string): Promise<void> {
  const clean = token.trim();
  if (clean.length === 0) throw new Error("the token is empty");
  const file = tokenFile(secretsDir, id);
  await mkdir(join(secretsDir, "connections"), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ token: clean })}\n`, { encoding: "utf8", mode: 0o600 });
  // An existing file keeps its old mode on write; make sure it is private.
  await chmod(file, 0o600).catch(() => undefined);
}

export async function removeConnectionToken(secretsDir: string, id: string): Promise<void> {
  if (!isConnectionId(id)) return;
  await rm(tokenFile(secretsDir, id), { force: true });
}
