/**
 * Rotation policy for the daemon's own log files, expressed as data only.
 *
 * Nothing here opens, renames or deletes anything: `planRotation` returns the
 * operations a caller may apply. Keeping it pure means the policy can be tested
 * without a temp directory and a crash mid-rotation cannot corrupt state.
 */

export interface RotationPolicy {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export interface LogFile {
  readonly path: string;
  readonly size: number;
}

export interface RotationRename {
  readonly from: string;
  readonly to: string;
}

export interface RotationPlan {
  /** Newest suffix first, active file (`x.log` -> `x.log.1`) last. */
  readonly renames: RotationRename[];
  /** Files a caller should unlink before applying the renames. */
  readonly remove: string[];
}

const MIN_FILES = 1;
const MAX_FILES = 50;
const MIN_BYTES = 1024;
const MAX_BYTES = 1024 * 1024 * 1024;

const SUFFIX = /\.(\d+)$/;

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const kind = typeof value;
  if (kind === "string") {
    return `"${value as string}"`;
  }
  if (kind === "number" || kind === "boolean" || kind === "bigint") {
    return String(value);
  }
  return kind;
}

function readField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `rotation policy field ${field} must be a finite number, got ${describeValue(value)}`,
    );
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Validate an untrusted policy object. Out-of-range values are clamped rather
 * than rejected so a typo in config degrades to a sane bound; only a value that
 * is not a finite number is an error, because no clamp can rescue it.
 */
export function parsePolicy(input: unknown): RotationPolicy {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`rotation policy must be an object, got ${describeValue(input)}`);
  }
  const record = input as Record<string, unknown>;
  const maxFiles = readField(record, "maxFiles");
  const maxBytes = readField(record, "maxBytes");

  return {
    maxFiles: clamp(maxFiles, MIN_FILES, MAX_FILES),
    maxBytes: clamp(maxBytes, MIN_BYTES, MAX_BYTES),
  };
}

interface Member {
  readonly base: string;
  readonly path: string;
  readonly suffix: number;
  readonly size: number;
}

function toMember(file: LogFile): Member {
  const match = SUFFIX.exec(file.path);
  if (match === null) {
    return { base: file.path, path: file.path, suffix: 0, size: file.size };
  }
  return {
    base: file.path.slice(0, match.index),
    path: file.path,
    suffix: Number.parseInt(match[1] ?? "0", 10),
    size: file.size,
  };
}

/** Group existing files by the log they belong to, preserving input order. */
function group(files: readonly LogFile[]): Member[][] {
  const groups = new Map<string, Member[]>();
  for (const file of files) {
    const member = toMember(file);
    const members = groups.get(member.base) ?? [];
    members.push(member);
    groups.set(member.base, members);
  }
  return [...groups.values()];
}

/**
 * Plan rotation for one log family. Only the active file (`suffix === 0`)
 * triggers a rotation: archived files are already bounded by `maxFiles`, and
 * rotating one merely because it is large would shuffle immutable history.
 */
function planGroup(members: readonly Member[], policy: RotationPolicy): RotationPlan {
  const active = members.find((member) => member.suffix === 0);
  if (active === undefined || active.size <= policy.maxBytes) {
    return { renames: [], remove: [] };
  }

  const renames: RotationRename[] = [];
  const remove: string[] = [];
  const newestFirst = [...members].sort((left, right) => right.suffix - left.suffix);

  for (const member of newestFirst) {
    const target = member.suffix + 1;
    if (target > policy.maxFiles) {
      remove.push(member.path);
    } else {
      renames.push({ from: member.path, to: `${member.base}.${target}` });
    }
  }

  return { renames, remove };
}

/**
 * Compute the operations needed to bound every log family. Each family is
 * planned independently; within a family renames run newest-first so a target
 * name is always free, and `remove` may be applied before any rename.
 */
export function planRotation(files: readonly LogFile[], policy: RotationPolicy): RotationPlan {
  const renames: RotationRename[] = [];
  const remove: string[] = [];

  for (const members of group(files)) {
    const plan = planGroup(members, policy);
    renames.push(...plan.renames);
    remove.push(...plan.remove);
  }

  return { renames, remove };
}
