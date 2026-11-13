import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { Event } from "../protocol/types.js";
import { hashContent, MAX_FILE_BYTES } from "./scan.js";

/**
 * Applying someone else's file, without ever losing yours.
 *
 * If the incoming change was based on the version on disk, it lands normally.
 * If the file changed here since then, both versions are kept: yours stays at
 * its path, theirs becomes `name.conflict-<node>-<seq>`. Nothing is deleted to
 * make a merge look clean, and the event stream records that it happened.
 */
export type ApplyOutcome =
  | { readonly kind: "written"; readonly path: string }
  | { readonly kind: "deleted"; readonly path: string }
  | { readonly kind: "same"; readonly path: string }
  | { readonly kind: "conflict"; readonly path: string; readonly keptAs: string }
  | { readonly kind: "refused"; readonly path: string; readonly reason: string };

export interface WorkspaceEventData {
  readonly op: "put" | "delete";
  readonly path: string;
  readonly content?: string;
  readonly hash?: string;
  /** Hash the sender believed was on disk when it edited; absent for new files. */
  readonly base?: string;
}

export function parseWorkspaceEvent(event: Event): WorkspaceEventData | null {
  if (event.type !== "workspace") return null;
  const data = event.data as Record<string, unknown> | null;
  if (data === null || typeof data !== "object") return null;
  const op = data["op"];
  const path = data["path"];
  if (op !== "put" && op !== "delete") return null;
  if (typeof path !== "string" || path.length === 0) return null;
  if (path.includes("..") || path.startsWith("/")) return null;
  const content = typeof data["content"] === "string" ? data["content"] : undefined;
  const hash = typeof data["hash"] === "string" ? data["hash"] : undefined;
  const base = typeof data["base"] === "string" ? data["base"] : undefined;
  if (op === "put" && (content === undefined || hash === undefined)) return null;
  return { op, path, ...(content !== undefined ? { content } : {}), ...(hash !== undefined ? { hash } : {}), ...(base !== undefined ? { base } : {}) };
}

async function readIfThere(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function applyWorkspaceEvent(root: string, event: Event): Promise<ApplyOutcome> {
  const data = parseWorkspaceEvent(event);
  if (data === null) return { kind: "refused", path: "", reason: "not a workspace event" };
  const target = join(root, data.path);

  if (data.op === "delete") {
    const before = await readIfThere(target);
    if (before === null) return { kind: "same", path: data.path };
    if (data.base !== undefined && hashContent(before) !== data.base) {
      // Someone edited it here after the delete was written: keep the file.
      return { kind: "conflict", path: data.path, keptAs: data.path };
    }
    await fs.rm(target, { force: true });
    return { kind: "deleted", path: data.path };
  }

  const content = data.content ?? "";
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { kind: "refused", path: data.path, reason: "too large" };
  }
  const hash = data.hash ?? hashContent(content);
  const current = await readIfThere(target);

  if (current === null) {
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return { kind: "written", path: data.path };
  }

  const localHash = hashContent(current);
  if (localHash === hash) return { kind: "same", path: data.path };
  if (data.base !== undefined && localHash === data.base) {
    await fs.writeFile(target, content, "utf8");
    return { kind: "written", path: data.path };
  }

  const suffix = `.conflict-${event.node}-${String(event.seq)}`;
  const keptAs = `${data.path}${suffix}`;
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(join(root, keptAs), content, "utf8");
  return { kind: "conflict", path: data.path, keptAs };
}
