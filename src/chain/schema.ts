/**
 * Typed access to the chain store's SQL schema.
 *
 * The DDL lives in `schema.sql` next to this module so it can be read by tools
 * other than TypeScript (sqlite3 CLI, migrations, reviewers). This module is the
 * only way the store loads it: nothing here runs at import time, and no file is
 * touched until `readSchema`, `statements`, `versionFrom` or `initSchema` is
 * actually called.
 *
 * The `.sql` file is not copied into `dist/` by `tsc`, so resolution tries the
 * module's own directory first (works from `src/chain/` via tsx) and then the
 * source tree relative to `dist/chain/` (two levels up, then `src/chain/`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/** Schema revision stored in SQLite's `PRAGMA user_version`. */
export const SCHEMA_VERSION = 1;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where `schema.sql` may live, in priority order. `join(HERE, "..", "..")` is
 * the repo root both when running from `src/chain/` and from `dist/chain/`.
 */
const CANDIDATES: readonly string[] = [
  join(HERE, "schema.sql"),
  join(HERE, "..", "..", "src", "chain", "schema.sql"),
  join(process.cwd(), "src", "chain", "schema.sql"),
];

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "ENOENT" || err.code === "ENOTDIR")
  );
}

function loadFile(): string {
  for (const candidate of CANDIDATES) {
    try {
      return readFileSync(candidate, "utf8");
    } catch (err) {
      if (!isMissingFile(err)) {
        throw err;
      }
    }
  }
  throw new Error(
    `schema.sql not found; looked in: ${CANDIDATES.join(", ")}`,
  );
}

let cached: string | undefined;

/** Raw contents of `schema.sql`, including the comment header and PRAGMA. */
export function readSchema(): string {
  cached ??= loadFile();
  return cached;
}

/**
 * Executable statements from `schema.sql`: `--` comment lines dropped, blank
 * lines dropped, trailing semicolons removed. The DDL contains no string
 * literals with semicolons, so splitting on `;` is safe.
 */
export function statements(): string[] {
  const withoutComments = readSchema()
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Value of `PRAGMA user_version`, or 0 when the database has never been initialised. */
export function versionFrom(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  const value = row?.["user_version"];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw new Error(`could not read user_version (got ${String(value)})`);
}

/**
 * Bring `db` up to `SCHEMA_VERSION`, returning the version it now reports.
 *
 * Idempotent: a database already at the current version is left untouched, so
 * the `PRAGMA user_version = 1` line in the file cannot roll back a future
 * migration. A database newer than this code throws instead of being downgraded.
 */
export function initSchema(db: DatabaseSync): number {
  const current = versionFrom(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `database schema version ${current} is newer than supported version ${SCHEMA_VERSION}`,
    );
  }
  if (current === SCHEMA_VERSION) {
    return current;
  }
  for (const statement of statements()) {
    db.exec(statement);
  }
  return versionFrom(db);
}
