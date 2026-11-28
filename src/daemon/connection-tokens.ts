import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The owner's sign-in for a connection.
 *
 * A connection (an MCP server) is chain config, and so is the sign-in that
 * makes it usable: every device has to be able to use a service the owner
 * connected once. The token lives in `mcp/tokens/<id>.json` in the agent
 * home, a directory the env already carries, so signing in on one device
 * signs in all of them — the same rule the model key follows.
 *
 * A token is never returned to the app and never logged; the app only learns
 * whether one is set.
 */

/** A connection id is a plain name: it becomes a file name here. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isConnectionId(id: string): boolean {
  return ID.test(id);
}

function tokenDir(home: string): string {
  return join(home, "mcp", "tokens");
}

function tokenFile(home: string, id: string): string {
  if (!isConnectionId(id)) throw new Error(`"${id}" is not a usable connection id`);
  return join(tokenDir(home), `${id}.json`);
}

/** The saved token, or null when there is none (or the file is unreadable). */
export async function loadConnectionToken(home: string, id: string): Promise<string | null> {
  if (!isConnectionId(id)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(tokenFile(home, id), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const token = (parsed as Record<string, unknown>)["token"];
    return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

export async function saveConnectionToken(home: string, id: string, token: string): Promise<void> {
  const clean = token.trim();
  if (clean.length === 0) throw new Error("the token is empty");
  const file = tokenFile(home, id);
  await mkdir(tokenDir(home), { recursive: true });
  await writeFile(file, `${JSON.stringify({ token: clean })}\n`, { encoding: "utf8", mode: 0o600 });
  // An existing file keeps its old mode on write; make sure it is private.
  await chmod(file, 0o600).catch(() => undefined);
}

export async function removeConnectionToken(home: string, id: string): Promise<void> {
  if (!isConnectionId(id)) return;
  await rm(tokenFile(home, id), { force: true });
}
