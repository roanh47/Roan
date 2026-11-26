/**
 * The workspace as one tree, seen from every node.
 *
 * `buildTree` is pure: it takes two local listings, the chain's workspace
 * events and the id of this device, and answers with the shape the explorer
 * renders — per node, per root, per file: what sync state the file is in.
 *
 * Nothing here touches the disk or the chain store. The daemon owns both, and
 * the explorer must stay renderable from a plain object (the tests prove that),
 * so the only inputs are the facts the caller already has.
 *
 * Statuses, in the words the UI uses:
 *   synced    the newest chain `workspace` put for this path has the hash on disk
 *   local     on disk and never published (no put, or one the chain no longer holds)
 *   pending   the chain holds a different hash than the disk — the two disagree
 *   conflict  a `.conflict-` sibling exists next to the file, so a merge kept both
 *   remote    the chain holds the path, this disk does not
 */

export type TreeRoot = "workspace" | "synced";
export type TreeKind = "file" | "dir";
export type TreeStatus = "synced" | "local" | "pending" | "conflict" | "remote";

export interface TreeEntry {
  /** Path relative to the root, forward slashes, never a dotfile. */
  readonly path: string;
  readonly kind: TreeKind;
  readonly bytes: number;
  readonly status: TreeStatus;
}

export interface TreeFolder {
  /** Which of the two roots the entries live under. */
  readonly root: TreeRoot;
  readonly entries: TreeEntry[];
}

export interface TreeNode {
  /** The node id the events carry. This device is first. */
  readonly node: string;
  readonly folders: TreeFolder[];
}

export interface WorkspaceTree {
  readonly nodes: TreeNode[];
}

/** One row of `listWorkspace`, plus the hash when the caller has it. */
export interface LocalEntry {
  readonly path: string;
  readonly kind: TreeKind;
  readonly bytes?: number;
  /**
   * sha256 hex of the bytes on disk, the same hash the chain publishes. Without
   * it the tree can only compare sizes, which it does, and says so.
   */
  readonly hash?: string;
}

/** The part of a chain event this module reads; a protocol `Event` fits. */
export interface TreeChainEvent {
  readonly node?: string;
  readonly seq?: number;
  readonly ts?: number;
  readonly type?: string;
  readonly data?: unknown;
}

export interface BuildTreeInput {
  /** Everything under `workspace/` — the agent's desk, never published. */
  readonly workspace: readonly LocalEntry[];
  /** Everything under the synced root. */
  readonly synced: readonly LocalEntry[];
  /** The chain, oldest first; only `workspace` events matter. */
  readonly chainEvents: readonly TreeChainEvent[];
  /** This device's node id, straight from the chain identity. */
  readonly self: string;
}

interface ParsedEvent {
  readonly op: "put" | "delete";
  readonly path: string;
  readonly node: string;
  readonly seq: number;
  readonly ts: number;
  readonly hash?: string;
  readonly bytes?: number;
}

const CONFLICT_MARKER = ".conflict-";

/** Precedence for a folder: the most notable thing inside it wins. */
const STATUS_RANK: Readonly<Record<TreeStatus, number>> = {
  conflict: 0,
  pending: 1,
  remote: 2,
  local: 3,
  synced: 4,
};

function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The canonical relative path, or null when it is one the tree refuses.
 *
 * Dotfiles are invisible at every level — they are where `.git`, keys and
 * editor state live, and an explorer that shows them invites reading them.
 * `..`, empty segments and absolute paths are refused rather than repaired:
 * a wrong path is a bug in the caller, not something to guess about.
 */
function normalisePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const path = raw.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (path.length === 0 || path.startsWith("/")) return null;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    if (segment.startsWith(".")) return null;
  }
  return segments.join("/");
}

function isConflictCopy(path: string): boolean {
  return path.includes(CONFLICT_MARKER);
}

/** Base paths that have a `.conflict-` sibling on disk. */
function conflictBases(files: readonly LocalEntry[]): ReadonlySet<string> {
  const bases = new Set<string>();
  for (const file of files) {
    const marker = file.path.indexOf(CONFLICT_MARKER);
    if (marker > 0) bases.add(file.path.slice(0, marker));
  }
  return bases;
}

function parseEvent(raw: TreeChainEvent, index: number): ParsedEvent | null {
  if (raw === null || typeof raw !== "object") return null;
  if (raw.type !== undefined && raw.type !== "workspace") return null;
  const data = raw.data;
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const op = record["op"];
  if (op !== "put" && op !== "delete") return null;
  const path = normalisePath(record["path"]);
  if (path === null) return null;
  const node = typeof raw.node === "string" && raw.node.length > 0 ? raw.node : "";
  if (node.length === 0) return null;
  const seq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? raw.seq : index;
  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : seq;
  const hash =
    typeof record["hash"] === "string"
      ? record["hash"]
      : typeof record["blobHash"] === "string"
        ? record["blobHash"]
        : undefined;
  const bytes =
    typeof record["bytes"] === "number" && Number.isFinite(record["bytes"]) && record["bytes"] >= 0
      ? record["bytes"]
      : undefined;
  return {
    op,
    path,
    node,
    seq,
    ts,
    ...(hash !== undefined ? { hash } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
  };
}

function isNewer(candidate: ParsedEvent, previous: ParsedEvent): boolean {
  if (candidate.seq !== previous.seq) return candidate.seq > previous.seq;
  return candidate.ts >= previous.ts;
}

function localEntries(entries: readonly LocalEntry[]): LocalEntry[] {
  const byPath = new Map<string, LocalEntry>();
  for (const entry of entries) {
    const path = normalisePath(entry.path);
    if (path === null) continue;
    const kind: TreeKind = entry.kind === "dir" ? "dir" : "file";
    byPath.set(path, { path, kind, bytes: kind === "dir" ? 0 : (entry.bytes ?? 0), ...(entry.hash !== undefined ? { hash: entry.hash } : {}) });
  }
  return [...byPath.values()];
}

/** True when the disk row and the chain row are the same content. */
function sameContent(event: ParsedEvent, local: LocalEntry): boolean {
  if (local.hash !== undefined && event.hash !== undefined) return local.hash === event.hash;
  if (local.bytes !== undefined && event.bytes !== undefined) return local.bytes === event.bytes;
  return false;
}

/**
 * One local file's status against the newest chain put for its path.
 *
 * A conflict sibling wins over everything: whatever the hashes say, a person
 * has two versions to look at. With no hash on either side there is no honest
 * match to claim, so the file is `local` — a size is not an identity.
 */
function localStatus(
  entry: LocalEntry,
  newest: ParsedEvent | undefined,
  conflicts: ReadonlySet<string>,
): TreeStatus {
  if (conflicts.has(entry.path) || isConflictCopy(entry.path)) return "conflict";
  if (newest === undefined || newest.op === "delete") return "local";
  if (entry.hash !== undefined && newest.hash !== undefined) {
    return entry.hash === newest.hash ? "synced" : "pending";
  }
  if (entry.bytes !== undefined && newest.bytes !== undefined) {
    return entry.bytes === newest.bytes ? "synced" : "pending";
  }
  return "local";
}

function aggregate(statuses: readonly TreeStatus[]): TreeStatus {
  if (statuses.length === 0) return "local";
  let best: TreeStatus = statuses[0] ?? "local";
  for (const status of statuses) if (STATUS_RANK[status] < STATUS_RANK[best]) best = status;
  return best;
}

/**
 * Every folder implied by the file paths, plus the empty local folders the
 * listing already knew about. A folder wears the most notable status inside
 * it, so a directory with one conflict reads as a conflict at a glance.
 */
function withFolders(files: readonly TreeEntry[], explicitDirs: readonly LocalEntry[]): TreeEntry[] {
  const children = new Map<string, TreeStatus[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const dir = parts.slice(0, depth).join("/");
      const statuses = children.get(dir) ?? [];
      statuses.push(file.status);
      children.set(dir, statuses);
    }
  }
  const entries: TreeEntry[] = [...files];
  for (const [path, statuses] of children) {
    entries.push({ path, kind: "dir", bytes: 0, status: aggregate(statuses) });
  }
  for (const dir of explicitDirs) {
    if (children.has(dir.path)) continue;
    entries.push({ path: dir.path, kind: "dir", bytes: 0, status: "local" });
  }
  return entries.sort((a, b) => comparePaths(a.path, b.path));
}

/** The `workspace/` root: free files, listed and never published. */
function workspaceFolder(local: readonly LocalEntry[]): TreeFolder {
  const files = local.filter((entry) => entry.kind === "file");
  const dirs = local.filter((entry) => entry.kind === "dir");
  const conflicts = conflictBases(files);
  const rows: TreeEntry[] = files.map((file) => ({
    path: file.path,
    kind: "file" as const,
    bytes: file.bytes ?? 0,
    status: conflicts.has(file.path) || isConflictCopy(file.path) ? "conflict" : "local",
  }));
  return { root: "workspace", entries: withFolders(rows, dirs) };
}

/** The synced root: the disk plus whatever the chain holds that it does not. */
function syncedFolder(local: readonly LocalEntry[], newest: ReadonlyMap<string, ParsedEvent>): TreeFolder {
  const files = local.filter((entry) => entry.kind === "file");
  const dirs = local.filter((entry) => entry.kind === "dir");
  const conflicts = conflictBases(files);
  const localPaths = new Set(local.map((entry) => entry.path));
  const rows: TreeEntry[] = files.map((file) => ({
    path: file.path,
    kind: "file" as const,
    bytes: file.bytes ?? 0,
    status: localStatus(file, newest.get(file.path), conflicts),
  }));
  for (const [path, event] of newest) {
    if (event.op !== "put") continue;
    if (localPaths.has(path)) continue;
    rows.push({ path, kind: "file", bytes: event.bytes ?? 0, status: "remote" });
  }
  return { root: "synced", entries: withFolders(rows, dirs) };
}

/**
 * Another node's view: the newest put it made for each path. A file this disk
 * already holds under the same hash is `synced` (the point of syncing), and
 * everything else is `remote` — it lives in the chain, not here.
 */
function remoteFolder(puts: readonly ParsedEvent[], local: readonly LocalEntry[]): TreeFolder {
  const onDisk = new Map<string, LocalEntry>();
  for (const entry of local) if (entry.kind === "file") onDisk.set(entry.path, entry);
  const rows: TreeEntry[] = [];
  for (const event of puts) {
    const here = onDisk.get(event.path);
    rows.push({
      path: event.path,
      kind: "file",
      bytes: event.bytes ?? 0,
      status: here !== undefined && sameContent(event, here) ? "synced" : "remote",
    });
  }
  return { root: "synced", entries: withFolders(rows, []) };
}

/**
 * The tree every panel renders: this device first, then every node that ever
 * put a file, alphabetically. Other nodes get only the synced root — their
 * `workspace/` never travels, so there is nothing to show and nothing to
 * pretend about.
 */
export function buildTree(input: BuildTreeInput): WorkspaceTree {
  const self = typeof input.self === "string" && input.self.length > 0 ? input.self : "this device";
  const workspaceLocal = localEntries(input.workspace ?? []);
  const syncedLocal = localEntries(input.synced ?? []);

  const newest = new Map<string, ParsedEvent>();
  const perNode = new Map<string, Map<string, ParsedEvent>>();
  (input.chainEvents ?? []).forEach((raw, index) => {
    const event = parseEvent(raw, index);
    if (event === null) return;
    const previous = newest.get(event.path);
    if (previous === undefined || isNewer(event, previous)) newest.set(event.path, event);
    let mine = perNode.get(event.node);
    if (mine === undefined) {
      mine = new Map<string, ParsedEvent>();
      perNode.set(event.node, mine);
    }
    const before = mine.get(event.path);
    if (before === undefined || isNewer(event, before)) mine.set(event.path, event);
  });

  const nodes: TreeNode[] = [
    {
      node: self,
      folders: [workspaceFolder(workspaceLocal), syncedFolder(syncedLocal, newest)],
    },
  ];

  const others = [...perNode.keys()].filter((node) => node !== self).sort(comparePaths);
  for (const node of others) {
    const events = [...(perNode.get(node)?.values() ?? [])];
    const puts = events.filter((event) => event.op === "put");
    if (puts.length === 0) continue;
    nodes.push({ node, folders: [remoteFolder(puts, syncedLocal)] });
  }

  return { nodes };
}

export interface TreeSummary {
  /** Files a person would count, conflict copies excluded (the base carries it). */
  readonly files: number;
  readonly synced: number;
  /** Files whose own `.conflict-` sibling exists. */
  readonly conflicts: number;
}

/** The line above the explorer: `N files · M synced · K conflicts`. */
export function summariseTree(entries: readonly TreeEntry[]): TreeSummary {
  let files = 0;
  let synced = 0;
  let conflicts = 0;
  for (const entry of entries) {
    if (entry.kind !== "file" || isConflictCopy(entry.path)) continue;
    files += 1;
    if (entry.status === "synced") synced += 1;
    if (entry.status === "conflict") conflicts += 1;
  }
  return { files, synced, conflicts };
}
