/**
 * Planning and applying an import.
 *
 * The plan is the whole safety story: every entry whose target name already
 * exists is a conflict, reported to the user and never written. Applying only
 * happens with an explicit `confirm === true`; a plan alone writes nothing.
 */

import type { EnvEntry } from "../env/types.js";

export type ImportConflictReason = "exists" | "duplicate";

export interface ImportConflict {
  /** Target name that could not be used, e.g. `imported/CLAUDE.md`. */
  path: string;
  /** `exists`: the env already has this name. `duplicate`: the batch does too. */
  reason: ImportConflictReason;
  entry: EnvEntry;
}

export interface ImportPlan {
  /** Entries that can be written because their target name is free. */
  adds: EnvEntry[];
  /** Entries that are left alone, sorted by path. */
  conflicts: ImportConflict[];
}

function asArray<T>(value: readonly T[] | undefined, what: string): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array`);
  return value;
}

/**
 * Split a batch of entries into what can be added and what collides.
 *
 * `existingNames` is the set of target names the env already holds (for example
 * every current entry path). Matching is exact: an import writes a new name, it
 * does not replace the file that name belongs to.
 */
export function planImport(
  existingNames: readonly string[],
  entries: readonly EnvEntry[],
): ImportPlan {
  const existing = new Set(asArray(existingNames, "existingNames"));
  const seen = new Set<string>();
  const adds: EnvEntry[] = [];
  const conflicts: ImportConflict[] = [];

  const ordered = [...asArray(entries, "entries")].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const entry of ordered) {
    if (existing.has(entry.path)) {
      conflicts.push({ path: entry.path, reason: "exists", entry });
      continue;
    }
    if (seen.has(entry.path)) {
      conflicts.push({ path: entry.path, reason: "duplicate", entry });
      continue;
    }
    seen.add(entry.path);
    adds.push(entry);
  }

  return { adds, conflicts };
}

/**
 * The entries to write, or an empty list.
 *
 * Only `confirm === true` releases anything; every other value — including a
 * missing confirmation — means the user has not agreed and nothing is written.
 */
export function applyImport(plan: ImportPlan, confirm: boolean): EnvEntry[] {
  if (confirm !== true) return [];
  return plan.adds.map((entry) => ({ ...entry }));
}
