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

/**
 * A browser sign-in: the token, what renews it, and who Roan is to that
 * service. Kept in the same file as a pasted token, so it travels the same way.
 */
export interface ConnectionSignIn {
  readonly token: string;
  readonly refreshToken: string | null;
  /** When the token ends, in milliseconds; null when it does not say. */
  readonly expiresAt: number | null;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly tokenEndpoint: string;
  /** The server the token is for. */
  readonly resource: string;
}

function optional(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The browser sign-in of a connection, or null when it has none (a pasted token is not one). */
export async function loadConnectionSignIn(home: string, id: string): Promise<ConnectionSignIn | null> {
  if (!isConnectionId(id)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(tokenFile(home, id), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const data = parsed as Record<string, unknown>;
    const token = optional(data["token"]);
    const clientId = optional(data["clientId"]);
    const tokenEndpoint = optional(data["tokenEndpoint"]);
    const resource = optional(data["resource"]);
    if (token === null || clientId === null || tokenEndpoint === null || resource === null) return null;
    return {
      token,
      refreshToken: optional(data["refreshToken"]),
      expiresAt: typeof data["expiresAt"] === "number" && Number.isFinite(data["expiresAt"]) ? data["expiresAt"] : null,
      clientId,
      clientSecret: optional(data["clientSecret"]),
      tokenEndpoint,
      resource,
    };
  } catch {
    return null;
  }
}

export async function saveConnectionSignIn(home: string, id: string, signIn: ConnectionSignIn): Promise<void> {
  const file = tokenFile(home, id);
  await mkdir(tokenDir(home), { recursive: true });
  await writeFile(file, `${JSON.stringify(signIn)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined);
}

export async function removeConnectionToken(home: string, id: string): Promise<void> {
  if (!isConnectionId(id)) return;
  await rm(tokenFile(home, id), { force: true });
}
