import { randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import type { RoanPaths } from "./paths.js";

/**
 * What makes this machine part of a chain: who this node is, which chain it
 * belongs to, and the token peers must present. Lives in secrets/, per machine.
 */
export interface Identity {
  readonly nodeId: string;
  readonly chainId: string;
  readonly token: string;
  readonly createdAt: string;
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function newIdentity(): Identity {
  return {
    nodeId: `node-${randomId(4)}`,
    chainId: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
}

export async function loadIdentity(paths: RoanPaths): Promise<Identity | null> {
  let raw: string;
  try {
    raw = await readFile(paths.identityFile, "utf8");
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("identity file is not an object");
  const p = parsed as Record<string, unknown>;
  for (const key of ["nodeId", "chainId", "token"] as const) {
    if (typeof p[key] !== "string" || (p[key] as string).length === 0) {
      throw new Error(`identity file is missing ${key}`);
    }
  }
  return {
    nodeId: p["nodeId"] as string,
    chainId: p["chainId"] as string,
    token: p["token"] as string,
    createdAt: typeof p["createdAt"] === "string" ? p["createdAt"] : new Date().toISOString(),
  };
}

/** Writes 0600 before the content lands, so the token is never world-readable. */
export async function saveIdentity(paths: RoanPaths, identity: Identity): Promise<void> {
  await writeFile(paths.identityFile, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.identityFile, 0o600);
}

export async function createIdentity(paths: RoanPaths): Promise<Identity> {
  const identity = newIdentity();
  await saveIdentity(paths, identity);
  return identity;
}
